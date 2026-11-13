import { createHash, randomUUID } from 'node:crypto';
import { edmontonTimestamp } from './report-time.ts';
import { automaticEmailSettings, automaticEmailsEnabled, emailRecipientLists } from './report-email-settings.js';
import { InputError } from './input-error.ts';
import { EMAIL_GROUP_SQL } from './email-outbox.js';

export function dailyEmailTime() {
  const time = process.env.BLOCKED_CALL_EMAIL_TIME?.trim() || '17:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('BLOCKED_CALL_EMAIL_TIME must use HH:mm (America/Edmonton).');
  return time;
}

export function dailyBlockedCalls(database, now = new Date()) {
  const day = edmontonTimestamp(now).slice(0, 10);
  return blockedCallsForDay(database, day);
}

export function selectedReportDay(value, now = new Date()) {
  const today = edmontonTimestamp(now).slice(0, 10);
  if (value === undefined || value === null) return today;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value || value > today) {
    throw new InputError('Choose a valid report date on or before today (Edmonton time).');
  }
  return value;
}

export function blockedCallsForDay(database, day) {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_blockages'").get();
  if (!exists) return { day, ids: [], photoCount: 0 };
  const records = database.prepare(`SELECT r.id FROM report_records r JOIN report_blockages b ON b.record_id = r.id
    WHERE r.record_type = 'daily' AND substr(r.occurred_at, 1, 10) = ? ORDER BY r.occurred_at, r.id`).all(day);
  const photoCount = database.prepare(`SELECT count(*) AS total FROM report_photos p JOIN report_records r ON r.id = p.record_id
    JOIN report_blockages b ON b.record_id = r.id WHERE r.record_type = 'daily' AND substr(r.occurred_at, 1, 10) = ?`).get(day).total;
  return { day, ids: records.map((record) => String(record.id)), photoCount: Number(photoCount) };
}

// Called by the managed worker. A unique day prevents duplicate daily batches.
export function queueDailyBlockedCalls(database, now = new Date()) {
  if (!automaticEmailsEnabled(database)) return false;
  const local = edmontonTimestamp(now);
  const time = dailyEmailTime();
  database.exec(`CREATE TABLE IF NOT EXISTS blocked_call_email_batches (
    id TEXT PRIMARY KEY, day TEXT NOT NULL UNIQUE, report_ids TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  const hasBlockages = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_blockages'").get();
  if (!hasBlockages) return false;
  if (hasBlockages) database.prepare(`UPDATE report_email_outbox SET superseded_at = ? WHERE sent_at IS NULL AND superseded_at IS NULL
    AND report_id IN (SELECT record_id FROM report_blockages)`).run(now.getTime());
  if (local.slice(11, 16) < time) return false;
  const day = local.slice(0, 10);
  const id = `blocked-day:${day}`;
  if (database.prepare('SELECT 1 FROM blocked_call_email_batches WHERE day = ?').get(day)) return false;
  const settings = automaticEmailSettings(database);
  const { to, cc } = emailRecipientLists(settings.to, settings.cc);
  database.exec(EMAIL_GROUP_SQL);
  database.exec('BEGIN IMMEDIATE');
  try {
    if (database.prepare('SELECT 1 FROM blocked_call_email_batches WHERE day = ?').get(day)) {
      database.exec('COMMIT'); return false;
    }
    const batch = dailyBlockedCalls(database, now);
    database.prepare('INSERT INTO blocked_call_email_batches (id, day, report_ids, created_at) VALUES (?, ?, ?, ?)')
      .run(id, day, JSON.stringify(batch.ids), now.getTime());
      const token = createHash('sha256').update(id).digest('hex');
      const outboxId = randomUUID();
      database.prepare(`INSERT INTO report_email_outbox (id, report_id, recipient, subject, body, message_id, next_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(outboxId, id, to.join(','),
        `[CM Reporting] Blocked calls - ${day} (${batch.ids.length} reports)`,
        `Blocked calls for ${day} (America/Edmonton), recorded by ${local.slice(11, 16)}.\n\n${batch.ids.length} report(s); ${batch.photoCount} photo(s).\n\nThe attached report files contain only this day's blocked-call reports and their photos.`,
        `<cm-daily-${token}@collectivewaste.ca>`, now.getTime());
      database.prepare('INSERT INTO report_email_groups (outbox_id, cc, formats) VALUES (?, ?, ?)')
        .run(outboxId, JSON.stringify(cc), JSON.stringify(settings.formats));
    database.exec('COMMIT'); return true;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
