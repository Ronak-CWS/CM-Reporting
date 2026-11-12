import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportEmailRecipients, reportTestRecipients, smtpConfig, validateReportEmailConfig } from '../lib/smtp-config.js';

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), verify: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));
import { sendEmail, verifySmtp } from '../lib/smtp.js';

beforeEach(() => {
  for (const [name, value] of Object.entries({ SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true', SMTP_IGNORE_TLS: 'false', SMTP_AUTH_MODE: 'login', SMTP_USER: 'sender@example.invalid', SMTP_PASS: 'test-password-never-a-real-secret',
    EMAIL_FROM: 'sender@example.invalid', REPORT_EMAIL_ENABLED: 'true', REPORT_EMAIL_TO: 'office@example.invalid' })) vi.stubEnv(name, value);
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, verify: smtp.verify, close: smtp.close });
  smtp.sendMail.mockResolvedValue({ accepted: ['office@example.invalid'], rejected: [] });
  smtp.verify.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); });

const message = { to: 'office@example.invalid', subject: 'New report', text: 'A report was saved.', messageId: '<test-report@example.invalid>' };

describe('SMTP notifications', () => {
  it('uses separate configured test recipients and sender without changing automatic emails', async () => {
    vi.stubEnv('REPORT_EMAIL_TEST_TO', 'test-only@example.invalid');
    vi.stubEnv('EMAIL_TEST_FROM_OPTIONS', 'test-sender@example.invalid,alternate@example.invalid');
    expect(reportTestRecipients()).toEqual(['test-only@example.invalid']);
    expect(reportEmailRecipients()).toEqual(['office@example.invalid']);
    await sendEmail(message, { testFrom: 'test-sender@example.invalid' });
    expect(smtp.sendMail).toHaveBeenLastCalledWith({ ...message, from: 'test-sender@example.invalid' });
    await sendEmail(message);
    expect(smtp.sendMail).toHaveBeenLastCalledWith({ ...message, from: 'sender@example.invalid' });
    await expect(sendEmail(message, { testFrom: 'unapproved@example.invalid' })).rejects.toMatchObject({ code: 'ECONFIG' });
    vi.stubEnv('REPORT_EMAIL_TEST_TO', '');
    expect(reportTestRecipients).toThrow('REPORT_EMAIL_TEST_TO');
  });
  it('uses the approved no-login relay without transmitting stale credentials and attaches PDF bytes', async () => {
    vi.stubEnv('SMTP_AUTH_MODE', 'none');
    vi.stubEnv('SMTP_HOST', 'Smtp1.shivtek.ca');
    vi.stubEnv('SMTP_PORT', '25');
    const attachments = [{ filename: 'CM-DAY-TEST-blocked-call.pdf', content: Buffer.from('%PDF-test'), contentType: 'application/pdf' }];
    await sendEmail({ ...message, attachments });
    expect(smtp.createTransport.mock.calls[0][0]).toMatchObject({ host: 'Smtp1.shivtek.ca', port: 25, requireTLS: true });
    expect(smtp.createTransport.mock.calls[0][0]).not.toHaveProperty('auth');
    expect(smtp.sendMail).toHaveBeenCalledWith({ ...message, from: 'sender@example.invalid', attachments });
    vi.stubEnv('SMTP_AUTH_MODE', 'invalid');
    expect(smtpConfig).toThrow('SMTP_AUTH_MODE');
  });

  it('refuses unsafe or oversized report attachments before contacting SMTP', async () => {
    const attachment = { filename: '../report.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' };
    await expect(sendEmail({ ...message, attachments: [attachment] })).rejects.toMatchObject({ code: 'EATTACHMENT' });
    await expect(sendEmail({ ...message, attachments: [{ ...attachment, filename: 'report.pdf', content: Buffer.alloc(5 * 1024 * 1024 + 1) }] })).rejects.toMatchObject({ code: 'EATTACHMENT' });
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it('uses the IT-approved TLS-disabled relay without sending stale credentials', async () => {
    vi.stubEnv('SMTP_HOST', 'Smtp1.shivtek.ca');
    vi.stubEnv('SMTP_PORT', '25');
    vi.stubEnv('SMTP_AUTH_MODE', 'none');
    vi.stubEnv('SMTP_REQUIRE_TLS', 'false');
    expect(smtpConfig).toThrow('SMTP_IGNORE_TLS');
    vi.stubEnv('SMTP_IGNORE_TLS', 'true');
    const attachments = [{ filename: 'report.pdf', content: Buffer.from('%PDF-test'), contentType: 'application/pdf' }];
    await sendEmail({ ...message, attachments });
    const settings = smtp.createTransport.mock.calls[0][0];
    expect(settings).toMatchObject({ host: 'Smtp1.shivtek.ca', port: 25, secure: false, requireTLS: false, ignoreTLS: true });
    expect(settings).not.toHaveProperty('auth');
    expect(settings).not.toHaveProperty('tls');
    expect(smtp.sendMail).toHaveBeenCalledWith({ ...message, from: 'sender@example.invalid', attachments });
  });

  it('rejects login credentials and other ports when TLS is disabled', () => {
    vi.stubEnv('SMTP_REQUIRE_TLS', 'false');
    vi.stubEnv('SMTP_IGNORE_TLS', 'true');
    vi.stubEnv('SMTP_PORT', '25');
    expect(smtpConfig).toThrow('SMTP_AUTH_MODE=none');
    vi.stubEnv('SMTP_AUTH_MODE', 'none');
    vi.stubEnv('SMTP_PORT', '587');
    expect(smtpConfig).toThrow('SMTP_PORT=25');
  });

  it('rejects conflicting or invalid TLS settings', () => {
    vi.stubEnv('SMTP_IGNORE_TLS', 'true');
    expect(smtpConfig).toThrow('SMTP_REQUIRE_TLS=false');
    vi.stubEnv('SMTP_REQUIRE_TLS', 'false');
    vi.stubEnv('SMTP_SECURE', 'true');
    expect(smtpConfig).toThrow('SMTP_SECURE=false');
    vi.stubEnv('SMTP_IGNORE_TLS', 'yes');
    expect(smtpConfig).toThrow('SMTP_IGNORE_TLS must be true or false');
  });

  it('retains required STARTTLS when the new setting is absent', () => {
    vi.stubEnv('SMTP_IGNORE_TLS', '');
    expect(smtpConfig()).toMatchObject({ requireTLS: true, ignoreTLS: false, auth: { user: 'sender@example.invalid' } });
  });

  it('requires STARTTLS with normal certificate checks on port 587 and uses the configured sender', async () => {
    await sendEmail(message);
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.invalid', port: 587, secure: false, requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, logger: false, debug: false,
      disableFileAccess: true, disableUrlAccess: true,
    }));
    expect(smtp.sendMail).toHaveBeenCalledWith({ ...message, from: 'sender@example.invalid' });
    expect(smtp.close).toHaveBeenCalledOnce();
  });

  it('checks connectivity without sending a message', async () => {
    await verifySmtp();
    expect(smtp.verify).toHaveBeenCalledOnce();
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(smtp.close).toHaveBeenCalledOnce();
  });

  it('rejects plaintext, invalid booleans, missing credentials and header injection before connecting', async () => {
    vi.stubEnv('SMTP_REQUIRE_TLS', 'false');
    expect(smtpConfig).toThrow('STARTTLS');
    vi.stubEnv('SMTP_REQUIRE_TLS', 'true');
    vi.stubEnv('SMTP_SECURE', 'yes');
    expect(smtpConfig).toThrow('true or false');
    vi.stubEnv('SMTP_SECURE', 'false');
    vi.stubEnv('SMTP_PASS', '');
    expect(smtpConfig).toThrow('SMTP_USER and SMTP_PASS');
    await expect(sendEmail({ ...message, to: 'office@example.invalid\r\nBcc: attacker@example.invalid' })).rejects.toThrow('plain email address');
    await expect(sendEmail({ ...message, subject: 'New\r\nBcc: attacker@example.invalid' })).rejects.toThrow('invalid');
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it('fails incomplete enabled setup and deduplicates the approved recipients', () => {
    vi.stubEnv('REPORT_EMAIL_TO', '');
    expect(validateReportEmailConfig).toThrow('REPORT_EMAIL_TO');
    vi.stubEnv('REPORT_EMAIL_ENABLED', 'false');
    expect(validateReportEmailConfig).not.toThrow();
    vi.stubEnv('REPORT_EMAIL_TO', 'office@example.invalid; OFFICE@example.invalid, dispatch@example.invalid');
    expect(reportEmailRecipients()).toEqual(['office@example.invalid', 'dispatch@example.invalid']);
  });

  it('does not expose provider responses or credentials and treats rejected recipients as failures', async () => {
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('Provider echoed test-password-never-a-real-secret'), { code: 'EAUTH' }));
    await expect(sendEmail(message)).rejects.toThrow('Email delivery failed (EAUTH).');
    smtp.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['office@example.invalid'] });
    await expect(sendEmail(message)).rejects.toThrow('EENVELOPE');
    expect(smtp.close).toHaveBeenCalledTimes(2);
  });
});
