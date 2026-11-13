import { accessResponse } from '../../../../../lib/request-access';
import { getLocalStorage } from '../../../../../lib/local-storage';
import { blockedCallsForDay, selectedReportDay } from '../../../../../lib/daily-blocked-call-email.js';
import { InputError } from '../../../../../lib/input-error';
import { dailyBlockedCallAttachments } from '../../../../../lib/report-attachment.js';
import { dailyBlockedCallWorkbook } from '../../../../../lib/blocked-call-workbook';
import { isReportSizeError } from '../../../../../lib/report-limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  const headers = { 'Cache-Control': 'private, no-store' };
  const format = new URL(request.url).searchParams.get('format') || 'pdf';
  if (!['pdf', 'xlsx'].includes(format)) return Response.json({ error: 'Choose PDF or Excel.' }, { status: 400, headers });
  try {
    const { sqlite, directory } = getLocalStorage();
    const batch = blockedCallsForDay(sqlite, selectedReportDay(new URL(request.url).searchParams.get('day')));
    const build = format === 'xlsx' ? dailyBlockedCallWorkbook : dailyBlockedCallAttachments;
    const [attachment] = await build(sqlite, directory, batch.ids, batch.day);
    return new Response(new Uint8Array(attachment.content), { headers: { ...headers,
      'Content-Type': attachment.contentType, 'Content-Disposition': `attachment; filename="${attachment.filename}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Length': String(attachment.content.length) } });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : isReportSizeError(error)
      ? 'The selected report exceeds the configured attachment size limit. Ask the administrator to review the report size limit.'
      : 'The daily report could not be prepared with all photos. Check the saved evidence and total attachment size.' },
      { status: error instanceof InputError ? error.status : 503, headers });
  }
}
