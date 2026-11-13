import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sendEmail, safeEmailErrorCode } from './smtp.js';

const directories = new WeakMap();
/** @returns {boolean} */
function enabledByDefault() { return true; }

export const EMAIL_GROUP_SQL = `CREATE TABLE IF NOT EXISTS report_email_groups (
  outbox_id TEXT PRIMARY KEY, cc TEXT NOT NULL DEFAULT '[]', formats TEXT NOT NULL DEFAULT '["pdf"]',
  accepted TEXT NOT NULL DEFAULT '[]')`;

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
  superseded_at INTEGER,
  UNIQUE (report_id, recipient)
)`;

export function openEmailOutbox(directory) {
  const database = new DatabaseSync(path.join(directory, 'reports.sqlite'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  database.exec(EMAIL_OUTBOX_SQL);
  database.exec(EMAIL_GROUP_SQL);
  if (!database.prepare('PRAGMA table_info(report_email_outbox)').all().some((column) => column.name === 'superseded_at')) {
    database.exec('ALTER TABLE report_email_outbox ADD COLUMN superseded_at INTEGER');
  }
  directories.set(database, directory);
  return database;
}

// Claims are atomic across processes. A crashed worker's lease expires after five minutes.
export async function deliverQueuedEmails(database, { send = sendEmail, now = Date.now, limit = 20,
  dailyEnabled = enabledByDefault, otherEnabled = enabledByDefault,
  buildAttachments = async (reportId, formats = ['pdf']) => {
    const { blockedCallAttachments } = await import('./report-attachment.js');
    if (reportId.startsWith('blocked-day:')) {
      const { emailReportAttachments } = await import('./report-email-attachments.js');
      const batch = database.prepare('SELECT day, report_ids FROM blocked_call_email_batches WHERE id = ?').get(reportId);
      if (!batch) throw Object.assign(new Error('Daily report snapshot not found.'), { code: 'EATTACHMENT' });
      return emailReportAttachments(database, directories.get(database), JSON.parse(String(batch.report_ids)), String(batch.day), formats);
    }
    return blockedCallAttachments(database, directories.get(database), reportId);
  },
} = {}) {
  const result = { sent: 0, deferred: 0 };
  database.exec(EMAIL_GROUP_SQL);
  for (let index = 0; index < limit; index++) {
    const time = now();
    const token = randomUUID();
    const row = database.prepare(`UPDATE report_email_outbox
      SET lock_token = ?, locked_until = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM report_email_outbox WHERE sent_at IS NULL AND superseded_at IS NULL
        AND ((report_id LIKE 'blocked-day:%' AND ? = 1) OR (report_id NOT LIKE 'blocked-day:%' AND ? = 1))
        AND next_attempt_at <= ? AND locked_until <= ? ORDER BY next_attempt_at, id LIMIT 1)
      RETURNING *`).get(token, time + 300000, Number(dailyEnabled()), Number(otherEnabled()), time, time);
    if (!row) break;
    try {
      const group = database.prepare('SELECT * FROM report_email_groups WHERE outbox_id = ?').get(row.id);
      const attachments = await buildAttachments(row.report_id, group ? JSON.parse(group.formats) : ['pdf']);
      // A user may switch automatic delivery off while a large attachment is being prepared.
      if (!(String(row.report_id).startsWith('blocked-day:') ? dailyEnabled() : otherEnabled())) {
        database.prepare("UPDATE report_email_outbox SET locked_until = 0, lock_token = '' WHERE id = ? AND lock_token = ?").run(row.id, token);
        break;
      }
      const to = String(row.recipient).split(',');
      const cc = group ? JSON.parse(group.cc) : [];
      const accepted = group ? JSON.parse(group.accepted) : [];
      const remaining = [...to, ...cc].filter((address) => !accepted.includes(address));
      if (remaining.length) {
        const delivery = await send({ to: group ? to : row.recipient, subject: row.subject, text: row.body, messageId: row.message_id, attachments,
          ...(group ? { cc, ...(accepted.length ? { envelopeTo: remaining } : {}) } : {}) });
        if (group) {
          const newlyAccepted = delivery?.accepted || remaining;
          const allAccepted = [...new Set([...accepted, ...newlyAccepted.filter((address) => remaining.includes(address))])];
          database.prepare('UPDATE report_email_groups SET accepted = ? WHERE outbox_id = ?').run(JSON.stringify(allAccepted), row.id);
          if (remaining.some((address) => !allAccepted.includes(address))) throw Object.assign(new Error('Recipient refused.'), { code: 'EENVELOPE' });
        }
      }
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
