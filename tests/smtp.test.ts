import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportEmailRecipients, smtpConfig, validateReportEmailConfig } from '../lib/smtp-config.js';

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), verify: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));
import { sendEmail, verifySmtp } from '../lib/smtp.js';

beforeEach(() => {
  for (const [name, value] of Object.entries({ SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true', SMTP_USER: 'sender@example.invalid', SMTP_PASS: 'test-password-never-a-real-secret',
    EMAIL_FROM: 'sender@example.invalid', REPORT_EMAIL_ENABLED: 'true', REPORT_EMAIL_TO: 'office@example.invalid' })) vi.stubEnv(name, value);
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, verify: smtp.verify, close: smtp.close });
  smtp.sendMail.mockResolvedValue({ accepted: ['office@example.invalid'], rejected: [] });
  smtp.verify.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); });

const message = { to: 'office@example.invalid', subject: 'New report', text: 'A report was saved.', messageId: '<test-report@example.invalid>' };

describe('authenticated SMTP notifications', () => {
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
