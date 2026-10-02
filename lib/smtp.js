import nodemailer from 'nodemailer';
import { emailAddress, smtpConfig } from './smtp-config.js';

const SAFE_CODES = new Set(['EAUTH', 'ESOCKET', 'ETIMEDOUT', 'EDNS', 'ECONNECTION', 'ETLS', 'EENVELOPE', 'EMESSAGE', 'ESTREAM', 'ECONFIG', 'EDELIVERY']);

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
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, dnsTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  }) };
}

/** @param {{ to: string, subject: string, text: string, messageId: string }} message */
export async function sendEmail(message) {
  const to = emailAddress(message.to, 'Recipient');
  if (!message.subject || /[\r\n]/.test(message.subject) || !message.text || !/^<[^\s<>]+@[^\s<>]+>$/.test(message.messageId)) {
    throw Object.assign(new Error('The email message is invalid.'), { code: 'EMESSAGE' });
  }
  const { client, from } = transport();
  try {
    const result = await client.sendMail({ from, to, subject: message.subject, text: message.text, messageId: message.messageId });
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
