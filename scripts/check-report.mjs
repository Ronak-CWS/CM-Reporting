import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { dataDirectory } from '../lib/storage-config.ts';
import { dailyBlockedCalls } from '../lib/daily-blocked-call-email.js';
import { blockedCallReport } from '../lib/blocked-call-report.js';
import { dailyBlockedCallAttachments, reportImageBudget, reportPhotoCopies } from '../lib/report-attachment.js';
import { reportAttachmentLimitBytes } from '../lib/report-limits.js';

function diagnosticError(error) {
  const seen = new Set();
  while (error?.cause && !seen.has(error)) {
    seen.add(error);
    error = error.cause;
  }
  // CLI diagnostics only. HTTP responses retain their generic error and never
  // serialize this cause, which may contain a private file path.
  return { error: error instanceof Error ? error.message : 'Unknown report preparation error.',
    ...(typeof error?.code === 'string' ? { code: error.code } : {}) };
}

/** Reads the current day's database and photos. No writes, outbox or SMTP calls. */
export async function checkReport(directory, now = new Date()) {
  const issues = [];
  let database;
  let day;
  let reports = 0;
  let photos = 0;
  let pdfBytes;
  let attachmentLimitBytes;
  let imageBudgetBytes;
  let stage = 'configuration';
  try {
    attachmentLimitBytes = reportAttachmentLimitBytes();
    stage = 'database';
    database = new DatabaseSync(path.join(directory, 'reports.sqlite'), { readOnly: true });
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;');
    const batch = dailyBlockedCalls(database, now);
    day = batch.day;
    reports = batch.ids.length;
    photos = batch.photoCount;
    // An empty report exercises the PDF engine and font independently of photos.
    try { await dailyBlockedCallAttachments(database, directory, [], day); }
    catch (error) { issues.push({ stage: 'pdf-engine-or-font', ...diagnosticError(error) }); }
    const entries = [];
    for (const id of batch.ids) {
      try {
        const entry = blockedCallReport(database, id);
        if (!entry) throw new Error('Blocked-call metadata is missing.');
        entries.push(entry);
      } catch (error) { issues.push({ stage: 'report-metadata', reportId: id, ...diagnosticError(error) }); }
    }
    let budget;
    try { budget = reportImageBudget(entries); imageBudgetBytes = budget; }
    catch (error) { issues.push({ stage: 'attachment-budget', ...diagnosticError(error) }); }
    if (budget) {
      for (const entry of entries) {
        for (const [index, photo] of entry.photos.entries()) {
          try { await reportPhotoCopies({ photos: [photo] }, directory, budget); }
          catch (error) { issues.push({ stage: 'photo', reference: entry.report.reference_number,
            reportId: entry.report.id, photo: index + 1, contentType: photo.content_type, ...diagnosticError(error) }); }
        }
      }
    }
    if (!issues.length) {
      try {
        const [attachment] = await dailyBlockedCallAttachments(database, directory, batch.ids, day);
        pdfBytes = attachment.content.length;
      } catch (error) { issues.push({ stage: 'daily-pdf', ...diagnosticError(error) }); }
    }
  } catch (error) { issues.push({ stage, ...diagnosticError(error) }); }
  finally { database?.close(); }
  return { status: issues.length ? 'FAIL' : 'PASS', directory, day, reports, photos, attachmentLimitBytes, imageBudgetBytes,
    ...(pdfBytes !== undefined ? { pdfBytes } : {}), issueCount: issues.length, omittedIssues: Math.max(0, issues.length - 20), issues: issues.slice(0, 20) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.env.NODE_ENV = 'production';
    nextEnv.loadEnvConfig(process.cwd(), false);
    const result = await checkReport(dataDirectory());
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', stage: 'configuration', ...diagnosticError(error) }, null, 2));
    process.exitCode = 1;
  }
}
