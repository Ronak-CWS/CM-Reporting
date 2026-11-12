import nodemailer from 'nodemailer';
import { emailAddress, smtpConfig, testEmailSenders } from './smtp-config.js';
import { reportAttachmentLimitBytes } from './report-limits.js';

const SAFE_CODES = new Set(['EAUTH', 'ESOCKET', 'ETIMEDOUT', 'EDNS', 'ECONNECTION', 'ETLS', 'EENVELOPE', 'EMESSAGE', 'ESTREAM', 'ECONFIG', 'EDELIVERY', 'EATTACHMENT']);

export function safeEmailErrorCode(error) {
  return error && SAFE_CODES.has(error.code) ? error.code : 'EDELIVERY';
}

function deliveryError(error) {
  const code = safeEmailErrorCode(error);
  return Object.assign(new Error(`Email delivery failed (${code}).`), { code });
}

function transport() {
  const { from, ...settings } = smtpConfig();
  return { from, client: nodemailer.createTransport({
    ...settings,
    ...(settings.ignoreTLS ? {} : { tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 60000, dnsTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  }) };
}

/** @param {{ to: string, subject: string, text: string, messageId: string, attachments?: Array<{ filename: string, content: Buffer, contentType: string }> }} message */
export async function sendEmail(message, { testFrom = '' } = {}) {
  const to = emailAddress(message.to, 'Recipient');
  if (!message.subject || /[\r\n]/.test(message.subject) || !message.text || !/^<[^\s<>]+@[^\s<>]+>$/.test(message.messageId)) {
    throw Object.assign(new Error('The email message is invalid.'), { code: 'EMESSAGE' });
  }
  if (message.attachments?.some((attachment) => !Buffer.isBuffer(attachment.content) ||
    attachment.contentType !== 'application/pdf' ||
    !/^[a-zA-Z0-9._-]+\.pdf$/.test(attachment.filename))) {
    throw Object.assign(new Error('The report attachment is invalid.'), { code: 'EATTACHMENT' });
  }
  if (message.attachments?.length && message.attachments.reduce((total, attachment) => total + attachment.content.length, 0) > reportAttachmentLimitBytes()) {
    throw Object.assign(new Error('The report attachments exceed the configured total size limit.'), { code: 'EATTACHMENT' });
  }
  if (testFrom && !testEmailSenders().includes(testFrom)) {
    throw Object.assign(new Error('Choose an approved test sender.'), { code: 'ECONFIG' });
  }
  const { client, from } = transport();
  try {
    const result = await client.sendMail({ from: testFrom || from, to, subject: message.subject, text: message.text, messageId: message.messageId,
      ...(message.attachments?.length ? { attachments: message.attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })) } : {}) });
    if (!result.accepted.length || result.rejected.length) throw Object.assign(new Error('Recipient rejected.'), { code: 'EENVELOPE' });
  } catch (error) { throw deliveryError(error); }
  finally { client.close(); }
}

export async function verifySmtp() {
  const { client } = transport();
  try { await client.verify(); }
  catch (error) { throw deliveryError(error); }
  finally { client.close(); }
}
