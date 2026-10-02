import nextEnv from '@next/env';
import { verifySmtp } from '../lib/smtp.js';

process.env.NODE_ENV ||= 'production';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
try {
  await verifySmtp();
  console.log('SMTP connection, TLS, and authentication verified. No email was sent; sender acceptance and inbox delivery still need a delivery test.');
} catch (error) {
  console.error(`SMTP check failed: ${error.message}`);
  process.exitCode = 1;
}
