import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverQueuedEmails as deliverWithAttachments, openEmailOutbox } from '../lib/email-outbox.js';

// Queue/lease tests isolate attachment construction; integration tests exercise real PDFs.
function deliverQueuedEmails(database: Parameters<typeof deliverWithAttachments>[0], options: Parameters<typeof deliverWithAttachments>[1] = {}) {
  return deliverWithAttachments(database, { buildAttachments: async () => [], ...options });
}

let directory: string;
let database: ReturnType<typeof openEmailOutbox>;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'cm-email-outbox-')); database = openEmailOutbox(directory); });
afterEach(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });

function queue(id = 'report-one') {
  database.prepare(`INSERT INTO report_email_outbox
    (id, report_id, recipient, subject, body, message_id, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, id, 'office@example.invalid', 'New report', 'Test report summary', `<${id}@example.invalid>`, 1000);
}

describe('durable report email delivery', () => {
  it('retries only rejected members of a shared email while retaining its To and CC headers', async () => {
    queue('group');
    database.prepare("UPDATE report_email_outbox SET report_id = 'blocked-day:2026-11-10', recipient = 'one@example.invalid,two@example.invalid'").run();
    database.prepare('INSERT INTO report_email_groups (outbox_id, cc) VALUES (?, ?)').run('group', JSON.stringify(['copy@example.invalid']));
    const send = vi.fn().mockResolvedValueOnce({ accepted: ['one@example.invalid', 'copy@example.invalid'], rejected: ['two@example.invalid'] });
    expect(await deliverQueuedEmails(database, { send, now: () => 1000 })).toEqual({ sent: 0, deferred: 1 });
    database.close(); database = openEmailOutbox(directory);
    send.mockResolvedValueOnce({ accepted: ['two@example.invalid'], rejected: [] });
    expect(await deliverQueuedEmails(database, { send, now: () => 31000 })).toEqual({ sent: 1, deferred: 0 });
    expect(send.mock.calls[1][0]).toMatchObject({ to: ['one@example.invalid', 'two@example.invalid'], cc: ['copy@example.invalid'], envelopeTo: ['two@example.invalid'] });
    expect(send.mock.calls[1][0].messageId).toBe(send.mock.calls[0][0].messageId);
    expect(await deliverQueuedEmails(database, { send, now: () => 90000 })).toEqual({ sent: 0, deferred: 0 });
  });

  it('stops before SMTP when automatic delivery is disabled during attachment preparation', async () => {
    queue();
    database.prepare("UPDATE report_email_outbox SET report_id = 'blocked-day:2026-11-10'").run();
    let enabled = true;
    const send = vi.fn();
    const buildAttachments = vi.fn(async () => { enabled = false; return []; });
    expect(await deliverQueuedEmails(database, { send, buildAttachments, now: () => 1000, dailyEnabled: () => enabled })).toEqual({ sent: 0, deferred: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(database.prepare('SELECT sent_at, locked_until FROM report_email_outbox').get()).toEqual({ sent_at: null, locked_until: 0 });
  });
  it('keeps a report pending when its photo attachment cannot be prepared', async () => {
    queue();
    const send = vi.fn();
    const buildAttachments = vi.fn().mockRejectedValue(Object.assign(new Error('private file path'), { code: 'EATTACHMENT' }));
    expect(await deliverQueuedEmails(database, { send, buildAttachments, now: () => 1000 })).toEqual({ sent: 0, deferred: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(database.prepare('SELECT sent_at, last_error_code FROM report_email_outbox').get())
      .toEqual({ sent_at: null, last_error_code: 'EATTACHMENT' });
  });

  it('retries after an outage, survives reopening, and does not resend a completed delivery', async () => {
    queue();
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('private provider response'), { code: 'EAUTH' })).mockResolvedValue(undefined);
    expect(await deliverQueuedEmails(database, { send, now: () => 1000 })).toEqual({ sent: 0, deferred: 1 });
    const failed = database.prepare('SELECT * FROM report_email_outbox').get();
    expect(failed).toMatchObject({ attempts: 1, next_attempt_at: 31000, last_error_code: 'EAUTH', sent_at: null });
    expect(JSON.stringify(failed)).not.toContain('private provider response');
    database.close();
    database = openEmailOutbox(directory);
    expect(await deliverQueuedEmails(database, { send, now: () => 30999 })).toEqual({ sent: 0, deferred: 0 });
    expect(await deliverQueuedEmails(database, { send, now: () => 31000 })).toEqual({ sent: 1, deferred: 0 });
    expect(await deliverQueuedEmails(database, { send, now: () => 90000 })).toEqual({ sent: 0, deferred: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });

  it('claims a pending notification for only one worker at a time', async () => {
    queue();
    const second = openEmailOutbox(directory);
    let complete!: () => void;
    const send = vi.fn(() => new Promise<{ accepted: string[]; rejected: string[] }>((resolve) => { complete = () => resolve({ accepted: ['office@example.invalid'], rejected: [] }); }));
    const first = deliverQueuedEmails(database, { send, now: () => 1000 });
    try {
      expect(await deliverQueuedEmails(second, { send, now: () => 1000 })).toEqual({ sent: 0, deferred: 0 });
      complete();
      expect(await first).toEqual({ sent: 1, deferred: 0 });
      expect(send).toHaveBeenCalledOnce();
    } finally { second.close(); }
  });

  it('retries a rejected recipient without resending to one already accepted', async () => {
    queue('first-recipient');
    queue('second-recipient');
    database.prepare("UPDATE report_email_outbox SET report_id = 'first-recipient', recipient = 'manager@example.invalid' WHERE id = 'second-recipient'").run();
    const send = vi.fn(async ({ to }: { to: string | string[] }) => {
      if (to === 'manager@example.invalid') throw Object.assign(new Error('Recipient refused'), { code: 'EENVELOPE' });
      return { accepted: Array.isArray(to) ? to : [to], rejected: [] };
    });
    expect(await deliverQueuedEmails(database, { send, now: () => 1000 })).toEqual({ sent: 1, deferred: 1 });
    send.mockReset().mockResolvedValue({ accepted: ['manager@example.invalid'], rejected: [] });
    expect(await deliverQueuedEmails(database, { send, now: () => 31000 })).toEqual({ sent: 1, deferred: 0 });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'manager@example.invalid' }));
  });

  it('recovers an abandoned lease and keeps recipients unique per report', async () => {
    queue();
    expect(() => queue()).toThrow();
    database.prepare("UPDATE report_email_outbox SET locked_until = 5000, lock_token = 'abandoned'").run();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await deliverQueuedEmails(database, { send, now: () => 4999 })).toEqual({ sent: 0, deferred: 0 });
    expect(await deliverQueuedEmails(database, { send, now: () => 5000 })).toEqual({ sent: 1, deferred: 0 });
  });

  it('starts the real one-shot worker on an empty temporary queue without contacting SMTP', async () => {
    const result = await promisify(execFile)(process.execPath, ['scripts/email-worker.mjs', '--once'], { env: {
      ...process.env, NODE_ENV: 'production', CM_DATA_DIR: directory, REPORT_EMAIL_ENABLED: 'true',
      REPORT_EMAIL_TO: 'office@example.invalid', SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587',
      SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'true', SMTP_IGNORE_TLS: 'false', SMTP_AUTH_MODE: 'login', SMTP_USER: 'sender@example.invalid',
      SMTP_PASS: 'unit-test-password-not-real', EMAIL_FROM: 'sender@example.invalid',
    } });
    expect(result.stdout).toBe('');
  });
});
