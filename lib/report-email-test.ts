import { randomUUID } from 'node:crypto';
import { getLocalStorage } from './local-storage';
import { InputError } from './input-error';
import { dailyBlockedCallAttachments } from './report-attachment.js';
import { dailyBlockedCalls } from './daily-blocked-call-email.js';
import { emailAddress, reportTestRecipients, smtpConfig, testEmailSenders } from './smtp-config.js';
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

export function emailTestConfig() {
  smtpConfig();
  return { recipients: reportTestRecipients(), senders: testEmailSenders() };
}

function testRecipients(override: unknown, defaults: string[]) {
  if (override === undefined || (typeof override === 'string' && !override.trim())) return defaults;
  if (typeof override !== 'string' || override.length > 25600 || /[\r\n]/.test(override)) {
    throw new InputError('Enter plain email addresses separated by commas or semicolons.');
  }
  const addresses = override.split(/[,;]/).map((address) => address.trim()).filter(Boolean);
  if (!addresses.length || addresses.length > 100) throw new InputError('Enter between 1 and 100 recipient email addresses.');
  try {
    return [...new Set(addresses.map((address) => emailAddress(address).toLowerCase()))];
  } catch {
    throw new InputError('Enter valid email addresses separated by commas or semicolons.');
  }
}

export async function sendReportTest(sender: string, recipientOverride?: unknown) {
  const { sqlite, directory } = getLocalStorage();
  const batch = dailyBlockedCalls(sqlite);
  const id = `blocked-day:${batch.day}`;
  const { recipients: defaults, senders } = emailTestConfig();
  if (!senders.includes(sender)) throw new InputError('Choose one of the approved test sender addresses.');
  // An office user's override applies only to this test; never save it to the
  // environment or automatic outbox, or append the configured recipients.
  const recipients = testRecipients(recipientOverride, defaults);
  // Persist the limit across processes and restarts; parallel clicks cannot send twice.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS report_email_test_sender_limits (
    report_id TEXT NOT NULL, sender TEXT NOT NULL, next_allowed_at INTEGER NOT NULL, PRIMARY KEY (report_id, sender))`);
  const now = Date.now();
  sqlite.prepare('DELETE FROM report_email_test_sender_limits WHERE next_allowed_at < ?').run(now - 86400000);
  const claimed = sqlite.prepare(`INSERT INTO report_email_test_sender_limits (report_id, sender, next_allowed_at) VALUES (?, ?, ?)
    ON CONFLICT(report_id, sender) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
    WHERE report_email_test_sender_limits.next_allowed_at <= ? RETURNING report_id`).get(id, sender, now + 60000, now);
  if (!claimed) throw new InputError('A test was recently requested with this sender. Wait one minute or choose the other sender.', 429);
  const attachments = await dailyBlockedCallAttachments(sqlite, directory, batch.ids, batch.day);
  const accepted: string[] = [];
  const failed: Array<{ recipient: string; code: string }> = [];
  for (const recipient of recipients) {
    try {
      await sendEmail({ to: recipient, subject: `[CM Reporting TEST] Blocked calls - ${batch.day}`,
        text: `This is a test email from CM Reporting.\n\nThe attached PDF contains only blocked calls for ${batch.day} (America/Edmonton): ${batch.ids.length} report(s), ${batch.photoCount} photo(s).\n\nThis test does not enable automatic notifications or create new reports.`,
        messageId: `<cm-test-${randomUUID()}@collectivewaste.ca>`, attachments }, { testFrom: sender });
      accepted.push(recipient);
    } catch (error) { failed.push({ recipient, code: safeEmailErrorCode(error) }); }
  }
  return { accepted, failed, attachmentFilename: attachments[0].filename };
}
