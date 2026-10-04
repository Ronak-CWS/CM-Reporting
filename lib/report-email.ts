import { createHash, randomUUID } from 'node:crypto';
import { appPath } from './app-path.js';
import { publicOrigin } from './auth-config';
import { reportEmailRecipients, reportEmailsEnabled } from './smtp-config.js';
import type { CreateReportRecordInput } from './report-types';
import type { StorageDatabase } from './local-storage';
import { reportDescription } from './report-description';

export function reportEmailStatements(database: StorageDatabase, input: CreateReportRecordInput, id: string, reference: string, photoCount: number) {
  if (!reportEmailsEnabled()) return [];
  const type = input.recordType === 'complaint' ? 'complaint' : 'blocked-call report';
  const text = [
    `A new ${type} has been submitted in CM Reporting.`, '',
    `Reference: ${reference}`, `Community: ${input.registeredCommunity}`,
    `Location: ${input.siteAddress || input.customerAddress}`,
    `Reported by: ${input.employeeName}`, `Occurred at: ${input.occurredAt} (America/Edmonton)`,
    `Category: ${input.category}`, `Priority: ${input.priority}`, `Status: ${input.status}`, '',
    'Description:', reportDescription(input), '',
    `Photo evidence: ${photoCount} photo(s), available after signing in.`,
    `Open CM Reporting and find reference ${reference}: ${publicOrigin()}${appPath('/')}`,
  ].join('\n');
  return reportEmailRecipients().map((recipient) => {
    const token = createHash('sha256').update(`${id}:${recipient}`).digest('hex');
    return database.prepare(`INSERT INTO report_email_outbox
      (id, report_id, recipient, subject, body, message_id, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(randomUUID(), id, recipient, `[CM Reporting] New ${type} - ${reference}`, text,
        `<cm-report-${token}@collectivewaste.ca>`, Date.now());
  });
}
