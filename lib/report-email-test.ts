import { randomUUID } from 'node:crypto';
import { getLocalStorage } from './local-storage';
import { InputError } from './input-error';
import { emailReportAttachments } from './report-email-attachments.js';
import { blockedCallsForDay, selectedReportDay } from './daily-blocked-call-email.js';
import { reportTestRecipients, smtpConfig, testEmailSenders } from './smtp-config.js';
import { emailRecipientLists, emailRecipients, emailReportFormats } from './report-email-settings.js';
import { safeEmailErrorCode, sendEmail } from './smtp.js';

export function emailTestReport(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new InputError('Blocked-call report not found.', 404);
  const storage = getLocalStorage();
  if (!storage.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_blockages'").get()) {
    throw new InputError('Blocked-call report not found.', 404);
  }
  const report = storage.sqlite.prepare(`SELECT r.reference_number FROM report_records r
    JOIN report_blockages b ON b.record_id = r.id WHERE r.id = ? AND r.record_type = 'daily'`).get(id);
  if (!report) throw new InputError('Blocked-call report not found.', 404);
  return { ...storage, reference: String(report.reference_number) };
}

export function emailDeliveryConfig() {
  smtpConfig();
  return { recipients: reportTestRecipients(), cc: emailRecipients(process.env.REPORT_EMAIL_TEST_CC ?? process.env.REPORT_EMAIL_CC ?? '', { optional: true }),
    senders: testEmailSenders() };
}

export async function sendReportEmail(sender: string, options: { to?: unknown; cc?: unknown; day?: unknown; formats?: unknown } = {}) {
  const { sqlite, directory } = getLocalStorage();
  const day = selectedReportDay(options.day);
  const formats = emailReportFormats(options.formats);
  const { recipients: defaults, cc: defaultCc, senders } = emailDeliveryConfig();
  if (!senders.includes(sender)) throw new InputError('Choose one of the approved sender addresses.');
  const to = options.to === undefined || (typeof options.to === 'string' && !options.to.trim()) ? defaults : emailRecipients(options.to);
  const copies = options.cc === undefined ? defaultCc : emailRecipients(options.cc, { optional: true });
  const recipients = emailRecipientLists(to, copies);
  const batch = blockedCallsForDay(sqlite, day);
  const id = `blocked-day:${batch.day}`;
  // Persist the limit across processes and restarts; parallel clicks cannot send twice.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS report_email_test_sender_limits (
    report_id TEXT NOT NULL, sender TEXT NOT NULL, next_allowed_at INTEGER NOT NULL, PRIMARY KEY (report_id, sender))`);
  const now = Date.now();
  sqlite.prepare('DELETE FROM report_email_test_sender_limits WHERE next_allowed_at < ?').run(now - 86400000);
  const claimed = sqlite.prepare(`INSERT INTO report_email_test_sender_limits (report_id, sender, next_allowed_at) VALUES (?, ?, ?)
    ON CONFLICT(report_id, sender) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
    WHERE report_email_test_sender_limits.next_allowed_at <= ? RETURNING report_id`).get(id, sender, now + 60000, now);
  if (!claimed) throw new InputError('An email was recently requested for this date and sender. Wait one minute before sending again.', 429);
  const attachments = await emailReportAttachments(sqlite, directory, batch.ids, batch.day, formats);
  const all = [...recipients.to, ...recipients.cc];
  try {
    const delivery = await sendEmail({ ...recipients, subject: `[CM Reporting] Blocked calls - ${batch.day}`,
      text: `Blocked calls for ${batch.day} (America/Edmonton): ${batch.ids.length} report(s), ${batch.photoCount} photo(s).\n\nThe attached report files include the saved photos.`,
      messageId: `<cm-manual-${randomUUID()}@collectivewaste.ca>`, attachments }, { testFrom: sender });
    return { accepted: delivery?.accepted || all, failed: (delivery?.rejected || []).map((recipient: string) => ({ recipient, code: 'EENVELOPE' })),
      attachmentFilenames: attachments.map((item) => item.filename) };
  } catch (error) {
    return { accepted: [], failed: all.map((recipient) => ({ recipient, code: safeEmailErrorCode(error) })),
      attachmentFilenames: attachments.map((item) => item.filename) };
  }
}
