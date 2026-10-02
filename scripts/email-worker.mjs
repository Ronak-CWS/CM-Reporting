import nextEnv from '@next/env';
import { dataDirectory } from '../lib/storage-config.ts';
import { reportEmailsEnabled, validateReportEmailConfig } from '../lib/smtp-config.js';
import { deliverQueuedEmails, openEmailOutbox } from '../lib/email-outbox.js';
import { safeEmailErrorCode } from '../lib/smtp.js';

process.env.NODE_ENV ||= 'production';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
let stopping = false;
let wake;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; wake?.(); });

try {
  validateReportEmailConfig();
  if (!reportEmailsEnabled()) throw new Error('Set REPORT_EMAIL_ENABLED=true after configuring SMTP and the approved recipient list.');
  const database = openEmailOutbox(dataDirectory());
  try {
    do {
      const result = await deliverQueuedEmails(database, { limit: 20 });
      if (result.sent || result.deferred) console.log(`Report emails: ${result.sent} accepted by SMTP; ${result.deferred} scheduled for retry.`);
      if (process.argv.includes('--once') || stopping) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 15000);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    } while (!stopping);
  } finally { database.close(); }
} catch (error) {
  console.error(`Email worker stopped (${safeEmailErrorCode(error)}). Check its private environment and data directory.`);
  process.exitCode = 1;
}
