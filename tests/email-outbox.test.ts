import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverQueuedEmails, openEmailOutbox } from '../lib/email-outbox.js';

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
    const send = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
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
    const send = vi.fn(async ({ to }: { to: string }) => {
      if (to === 'manager@example.invalid') throw Object.assign(new Error('Recipient refused'), { code: 'EENVELOPE' });
    });
    expect(await deliverQueuedEmails(database, { send, now: () => 1000 })).toEqual({ sent: 1, deferred: 1 });
    send.mockReset().mockResolvedValue(undefined);
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
      SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'true', SMTP_USER: 'sender@example.invalid',
      SMTP_PASS: 'unit-test-password-not-real', EMAIL_FROM: 'sender@example.invalid',
    } });
    expect(result.stdout).toBe('');
  });
});
