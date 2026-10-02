function booleanSetting(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export function emailAddress(value, setting = 'Email address') {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(value)) {
    throw new Error(`${setting} must contain a plain email address.`);
  }
  return value;
}

export function reportEmailsEnabled() {
  return booleanSetting('REPORT_EMAIL_ENABLED', false);
}

export function reportEmailRecipients() {
  const recipients = (process.env.REPORT_EMAIL_TO || '').split(/[,;]/).map((value) => value.trim()).filter(Boolean);
  if (!recipients.length || recipients.length > 100) throw new Error('Set REPORT_EMAIL_TO to the approved recipient addresses, separated by commas.');
  return [...new Set(recipients.map((value) => emailAddress(value, 'REPORT_EMAIL_TO').toLowerCase()))];
}

export function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim() || '';
  const portValue = process.env.SMTP_PORT?.trim() || '587';
  const port = Number(portValue);
  const secure = booleanSetting('SMTP_SECURE', false);
  const requireTLS = booleanSetting('SMTP_REQUIRE_TLS', true);
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Set SMTP_HOST to the SMTP server hostname.');
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a port from 1 to 65535.');
  if (!secure && !requireTLS) throw new Error('SMTP must use implicit TLS or require STARTTLS.');
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS || '';
  if (!user || !pass.trim()) throw new Error('Set SMTP_USER and SMTP_PASS in the private server environment.');
  const from = emailAddress(process.env.EMAIL_FROM?.trim() || '', 'EMAIL_FROM');
  return { host, port, secure, requireTLS, auth: { user, pass }, from };
}

// Configuration only: startup never contacts SMTP or sends a message.
export function validateReportEmailConfig() {
  if (!reportEmailsEnabled()) return;
  smtpConfig();
  reportEmailRecipients();
}
