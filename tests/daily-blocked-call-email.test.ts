import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailFixture } from './helpers/email-fixture.mjs';
import { dailyBlockedCalls, dailyEmailTime, queueDailyBlockedCalls } from '../lib/daily-blocked-call-email.js';
import { dailyBlockedCallAttachments } from '../lib/report-attachment.js';
import { deliverQueuedEmails, openEmailOutbox } from '../lib/email-outbox.js';
import { PDFDocument } from 'pdf-lib';

let fixture: Awaited<ReturnType<typeof createEmailFixture>>;
beforeEach(async () => {
  fixture = await createEmailFixture(await mkdtemp(path.join(tmpdir(), 'cm-daily-email-')));
  vi.stubEnv('REPORT_EMAIL_TO', 'office@example.invalid');
  vi.stubEnv('REPORT_EMAIL_ENABLED', 'true');
  vi.stubEnv('BLOCKED_CALL_EMAIL_TIME', '17:00');
});
afterEach(async () => { fixture.database.close(); await rm(fixture.directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function anotherReport(occurredAt: string, complaint = false) {
  const id = randomUUID();
  const row = { ...fixture.database.prepare('SELECT * FROM report_records WHERE id = ?').get(fixture.id),
    id, reference_number: `TEST-${id}`, occurred_at: occurredAt, record_type: complaint ? 'complaint' : 'daily' };
  const columns = Object.keys(row);
  fixture.database.prepare(`INSERT INTO report_records (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
  if (!complaint) fixture.database.prepare(`INSERT INTO report_blockages (record_id, scope, reason_code, reason_label, request_hash)
    VALUES (?, 'pickup', 'parked_vehicle', 'Vehicle blocking access', 'test')`).run(id);
  return id;
}

describe('daily blocked-call schedule', () => {
  it('does not queue or send when automatic delivery is off, even after the scheduled time', () => {
    vi.stubEnv('REPORT_EMAIL_ENABLED', 'false');
    expect(queueDailyBlockedCalls(fixture.database, new Date('2026-11-11T01:00:00Z'))).toBe(false);
    expect(fixture.database.prepare('SELECT count(*) AS n FROM report_email_outbox').get()?.n).toBe(0);
  });
  it('selects exactly one Edmonton day and excludes older, future and complaint records', async () => {
    anotherReport('2026-11-09T20:00:00-07:00');
    anotherReport('2026-11-11T08:00:00-07:00');
    anotherReport('2026-11-10T10:00:00-07:00', true);
    const batch = dailyBlockedCalls(fixture.database, new Date('2026-11-11T00:00:00Z'));
    expect(batch).toEqual({ day: '2026-11-10', ids: [fixture.id], photoCount: 2 });
    const [attachment] = await dailyBlockedCallAttachments(fixture.database, fixture.directory, batch.ids, batch.day);
    expect(attachment.filename).toBe('blocked-calls-2026-11-10.pdf');
    expect((await PDFDocument.load(attachment.content)).getPageCount()).toBe(1);
  });

  it('queues once at 5 PM, survives restarts, and delivers a PDF from the fixed daily record list', async () => {
    const before = new Date('2026-11-10T23:59:59Z');
    const due = new Date('2026-11-11T00:00:00Z');
    expect(queueDailyBlockedCalls(fixture.database, before)).toBe(false);
    expect(queueDailyBlockedCalls(fixture.database, due)).toBe(true);
    const other = openEmailOutbox(fixture.directory);
    try { expect(queueDailyBlockedCalls(other, due)).toBe(false); } finally { other.close(); }
    expect(fixture.database.prepare('SELECT count(*) AS n FROM report_email_outbox').get()?.n).toBe(1);
    anotherReport('2026-11-10T17:30:00-07:00');
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await deliverQueuedEmails(fixture.database, { send, now: () => due.getTime() })).toEqual({ sent: 1, deferred: 0 });
    expect(send.mock.calls[0][0].subject).toContain('2026-11-10 (1 reports)');
    expect(send.mock.calls[0][0].attachments[0].filename).toBe('blocked-calls-2026-11-10.pdf');
    expect(queueDailyBlockedCalls(fixture.database, new Date('2026-11-11T01:00:00Z'))).toBe(false);
  });

  it('keeps legacy individual blocked emails from being sent alongside the daily batch', () => {
    fixture.database.prepare(`INSERT INTO report_email_outbox (id, report_id, recipient, subject, body, message_id, next_attempt_at)
      VALUES ('old', ?, 'office@example.invalid', 'Old individual message', 'Old', '<old@example.invalid>', 0)`).run(fixture.id);
    queueDailyBlockedCalls(fixture.database, new Date('2026-11-10T18:00:00Z'));
    expect(fixture.database.prepare("SELECT superseded_at FROM report_email_outbox WHERE id = 'old'").get()?.superseded_at).toBeTypeOf('number');
  });

  it('creates an empty dated report without backfilling prior days and validates schedule time', async () => {
    const day = dailyBlockedCalls(fixture.database, new Date('2026-11-12T00:00:00Z'));
    expect(day.ids).toEqual([]);
    const [attachment] = await dailyBlockedCallAttachments(fixture.database, fixture.directory, [], day.day);
    expect((await PDFDocument.load(attachment.content)).getPageCount()).toBe(1);
    queueDailyBlockedCalls(fixture.database, new Date('2026-11-12T00:00:00Z'));
    expect(fixture.database.prepare('SELECT day FROM blocked_call_email_batches').all()).toEqual([{ day: '2026-11-11' }]);
    vi.stubEnv('BLOCKED_CALL_EMAIL_TIME', '25:99');
    expect(dailyEmailTime).toThrow('HH:mm');
  });
});
