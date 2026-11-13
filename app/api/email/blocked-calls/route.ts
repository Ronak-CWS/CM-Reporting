import { accessResponse, mutationFailure } from '../../../../lib/request-access';
import { InputError } from '../../../../lib/input-error';
import { emailDeliveryConfig, sendReportEmail } from '../../../../lib/report-email-test';
import { automaticEmailSettings, saveAutomaticEmailSettings } from '../../../../lib/report-email-settings.js';
import { readReportBody } from '../../../../lib/request-body';
import { safeEmailErrorCode } from '../../../../lib/smtp.js';
import { blockedCallsForDay, selectedReportDay, dailyEmailTime } from '../../../../lib/daily-blocked-call-email.js';
import { getLocalStorage } from '../../../../lib/local-storage';
import { isReportSizeError } from '../../../../lib/report-limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  try {
    const { sqlite } = getLocalStorage();
    const batch = blockedCallsForDay(sqlite, selectedReportDay(new URL(request.url).searchParams.get('day')));
    return Response.json({ ...emailDeliveryConfig(), day: batch.day, today: selectedReportDay(undefined), reportCount: batch.ids.length, photoCount: batch.photoCount,
      sendAt: dailyEmailTime(), automatic: automaticEmailSettings(sqlite) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : 'Email is not configured. Check the server SMTP settings, sender and recipients.' },
      { status: error instanceof InputError ? error.status : 503, headers });
  }
}

export async function POST(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  const originFailure = mutationFailure(request);
  if (originFailure) return Response.json({ error: originFailure.error }, { status: originFailure.status, headers });
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Choose a sender before sending.', 415);
    const { payload } = await readReportBody(request);
    if (typeof payload?.from !== 'string') throw new InputError('Choose a sender before sending.');
    const result = await sendReportEmail(payload.from, payload);
    return Response.json(result, { headers });
  } catch (error) {
    const code = safeEmailErrorCode(error);
    return Response.json({ error: error instanceof InputError ? error.message : isReportSizeError(error)
      ? 'The selected reports exceed the attachment size limit. Try one format or ask the administrator to review the size limit.' : code === 'EATTACHMENT'
      ? 'The report files could not be prepared with all photos. Check the saved photos and try again.'
      : 'The email could not be sent. Check the server email settings and try again.', code },
    { status: error instanceof InputError ? error.status : 503,
      headers: { ...headers, ...(error instanceof InputError && error.status === 429 ? { 'Retry-After': '60' } : {}) } });
  }
}

export async function PATCH(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  const originFailure = mutationFailure(request);
  if (originFailure) return Response.json({ error: originFailure.error }, { status: originFailure.status, headers });
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Send email settings as JSON.', 415);
    const { payload } = await readReportBody(request);
    const automatic = saveAutomaticEmailSettings(getLocalStorage().sqlite, payload);
    return Response.json({ automatic }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : 'Automatic email settings could not be saved. Check the SMTP configuration and recipients.' },
      { status: error instanceof InputError ? error.status : 503, headers });
  }
}
