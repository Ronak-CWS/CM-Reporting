import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sendEmail, safeEmailErrorCode } from './smtp.js';

export const EMAIL_OUTBOX_SQL = `CREATE TABLE IF NOT EXISTS report_email_outbox (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  sent_at INTEGER,
  UNIQUE (report_id, recipient)
)`;

export function openEmailOutbox(directory) {
  const database = new DatabaseSync(path.join(directory, 'reports.sqlite'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  database.exec(EMAIL_OUTBOX_SQL);
  return database;
}

// Claims are atomic across processes. A crashed worker's lease expires after five minutes.
export async function deliverQueuedEmails(database, { send = sendEmail, now = Date.now, limit = 20 } = {}) {
  const result = { sent: 0, deferred: 0 };
  for (let index = 0; index < limit; index++) {
    const time = now();
    const token = randomUUID();
    const row = database.prepare(`UPDATE report_email_outbox
      SET lock_token = ?, locked_until = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM report_email_outbox WHERE sent_at IS NULL
        AND next_attempt_at <= ? AND locked_until <= ? ORDER BY next_attempt_at, id LIMIT 1)
      RETURNING *`).get(token, time + 300000, time, time);
    if (!row) break;
    try {
      await send({ to: row.recipient, subject: row.subject, text: row.body, messageId: row.message_id });
    } catch (error) {
      const delay = Math.min(3600000, 30000 * 2 ** Math.min(Number(row.attempts) - 1, 7));
      database.prepare(`UPDATE report_email_outbox SET next_attempt_at = ?, locked_until = 0,
        lock_token = '', last_error_code = ? WHERE id = ? AND lock_token = ?`)
        .run(now() + delay, safeEmailErrorCode(error), row.id, token);
      result.deferred++;
      continue;
    }
    // Do not turn a post-send DB error into a new immediate SMTP attempt.
    database.prepare(`UPDATE report_email_outbox SET sent_at = ?, locked_until = 0,
      lock_token = '', last_error_code = '' WHERE id = ? AND lock_token = ?`).run(now(), row.id, token);
    result.sent++;
  }
  return result;
}
