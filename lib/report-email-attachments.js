import { dailyBlockedCallAttachments } from './report-attachment.js';
import { dailyBlockedCallWorkbook } from './blocked-call-workbook.ts';
import { emailReportFormats } from './report-email-settings.js';
import { reportAttachmentLimitBytes, reportSizeError } from './report-limits.js';

export async function emailReportAttachments(database, directory, ids, day, formats = ['pdf']) {
  const selected = emailReportFormats(formats);
  // Both files share the email allowance. Resize copies for each file without changing originals.
  const budget = Math.floor(reportAttachmentLimitBytes() / selected.length);
  const attachments = [];
  for (const format of selected) {
    const build = format === 'pdf' ? dailyBlockedCallAttachments : dailyBlockedCallWorkbook;
    attachments.push(...await build(database, directory, ids, day, budget));
  }
  if (attachments.reduce((sum, item) => sum + item.content.length, 0) > reportAttachmentLimitBytes()) {
    throw reportSizeError('The selected report attachments exceed the total email size limit.');
  }
  return attachments;
}
