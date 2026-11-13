import { InputError } from './input-error.ts';
import { emailAddress, reportEmailsEnabled, smtpConfig } from './smtp-config.js';

export function emailRecipients(value, { optional = false } = {}) {
  if (typeof value !== 'string' || value.length > 25600 || /[\r\n]/.test(value)) {
    throw new InputError('Enter plain email addresses separated by commas or semicolons.');
  }
  const addresses = value.split(/[,;]/).map((address) => address.trim()).filter(Boolean);
  if ((!optional && !addresses.length) || addresses.length > 100) throw new InputError('Enter between 1 and 100 recipient email addresses.');
  try { return [...new Set(addresses.map((address) => emailAddress(address).toLowerCase()))]; }
  catch { throw new InputError('Enter valid email addresses separated by commas or semicolons.'); }
}

export function emailRecipientLists(to, cc = []) {
  const recipients = emailRecipients(Array.isArray(to) ? to.join(',') : to);
  const copies = emailRecipients(Array.isArray(cc) ? cc.join(',') : cc, { optional: true }).filter((address) => !recipients.includes(address));
  if (recipients.length + copies.length > 100) throw new InputError('Use no more than 100 addresses across To and CC.');
  return { to: recipients, cc: copies };
}

/** @param {unknown} value */
export function emailReportFormats(value = ['pdf']) {
  if (!Array.isArray(value) || !value.length || value.length > 2 || value.some((format) => !['pdf', 'xlsx'].includes(format))) {
    throw new InputError('Select PDF, Excel, or both report formats.');
  }
  return ['pdf', 'xlsx'].filter((format) => value.includes(format));
}

function settingsRow(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS blocked_call_email_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER, recipients TEXT, cc TEXT, formats TEXT)`);
  return database.prepare('SELECT * FROM blocked_call_email_settings WHERE id = 1').get();
}

export function automaticEmailsEnabled(database) {
  const row = settingsRow(database);
  return row?.enabled == null ? reportEmailsEnabled() : Boolean(row.enabled);
}

export function automaticEmailSettings(database) {
  const row = settingsRow(database);
  const to = row?.recipients == null ? emailRecipients(process.env.REPORT_EMAIL_TO || '', { optional: true }) : JSON.parse(row.recipients);
  const cc = row?.cc == null ? emailRecipients(process.env.REPORT_EMAIL_CC || '', { optional: true }) : JSON.parse(row.cc);
  return { enabled: row?.enabled == null ? reportEmailsEnabled() : Boolean(row.enabled), to,
    cc: cc.filter((address) => !to.includes(address)), formats: emailReportFormats(row?.formats == null ? ['pdf'] : JSON.parse(row.formats)) };
}

// Only delivery preferences are saved here. SMTP credentials remain in the server environment.
export function saveAutomaticEmailSettings(database, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length ||
    Object.keys(changes).some((key) => !['enabled', 'to', 'cc', 'formats'].includes(key))) throw new InputError('Choose valid automatic email settings.');
  if ('enabled' in changes && typeof changes.enabled !== 'boolean') throw new InputError('Automatic emails must be on or off.');
  const current = settingsRow(database) || { enabled: null, recipients: null, cc: null, formats: null };
  const updated = { ...current };
  if ('enabled' in changes) updated.enabled = Number(changes.enabled);
  if ('to' in changes) {
    const to = emailRecipients(changes.to, { optional: true });
    updated.recipients = to.length ? JSON.stringify(to) : null;
  }
  if ('cc' in changes) updated.cc = JSON.stringify(emailRecipients(changes.cc, { optional: true }));
  if ('formats' in changes) updated.formats = JSON.stringify(emailReportFormats(changes.formats));
  const enabled = updated.enabled == null ? reportEmailsEnabled() : Boolean(updated.enabled);
  if (enabled) {
    emailRecipientLists(updated.recipients == null ? process.env.REPORT_EMAIL_TO || '' : JSON.parse(updated.recipients),
      updated.cc == null ? process.env.REPORT_EMAIL_CC || '' : JSON.parse(updated.cc));
    smtpConfig();
  }
  database.prepare(`INSERT INTO blocked_call_email_settings (id, enabled, recipients, cc, formats) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, recipients=excluded.recipients, cc=excluded.cc, formats=excluded.formats`)
    .run(updated.enabled, updated.recipients, updated.cc, updated.formats);
  return automaticEmailSettings(database);
}
