import nextEnv from '@next/env';
import { smtpConfig } from '../lib/smtp-config.js';
import { verifySmtp } from '../lib/smtp.js';

process.env.NODE_ENV ||= 'production';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
try {
  const { host, port, secure, ignoreTLS, auth } = smtpConfig();
  const encryption = ignoreTLS ? 'disabled (approved relay)' : secure ? 'implicit TLS' : 'STARTTLS required';
  console.log(`SMTP target: ${host}:${port}; authentication: ${auth ? 'login' : 'none'}; encryption: ${encryption}.`);
  await verifySmtp();
  console.log('SMTP connection verified with the configured authentication and encryption settings. No email was sent; sender acceptance and inbox delivery still need a delivery test.');
} catch (error) {
  console.error(`SMTP check failed: ${error.message}`);
  if (error.code === 'ETLS') console.error('Confirm that the relay supports the configured TLS mode and has a valid, trusted certificate. Automatic email settings were not changed.');
  process.exitCode = 1;
}
