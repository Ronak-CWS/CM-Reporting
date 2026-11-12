import { accessResponse, mutationFailure } from '../../../../lib/request-access';
import { InputError } from '../../../../lib/input-error';
import { emailTestConfig, sendReportTest } from '../../../../lib/report-email-test';
import { reportEmailsEnabled } from '../../../../lib/smtp-config.js';
import { readReportBody } from '../../../../lib/request-body';
import { safeEmailErrorCode } from '../../../../lib/smtp.js';
import { dailyBlockedCalls, dailyEmailTime } from '../../../../lib/daily-blocked-call-email.js';
import { getLocalStorage } from '../../../../lib/local-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  try {
    const batch = dailyBlockedCalls(getLocalStorage().sqlite);
    return Response.json({ ...emailTestConfig(), day: batch.day, reportCount: batch.ids.length, photoCount: batch.photoCount,
      sendAt: dailyEmailTime(), automaticEnabled: reportEmailsEnabled() }, { headers });
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
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Choose a test sender before sending.', 415);
    const { payload } = await readReportBody(request);
    if (typeof payload?.from !== 'string') throw new InputError('Choose a test sender before sending.');
    const result = await sendReportTest(payload.from);
    return Response.json(result, { headers });
  } catch (error) {
    const code = safeEmailErrorCode(error);
    return Response.json({ error: error instanceof InputError ? error.message : code === 'EATTACHMENT'
      ? 'The report PDF could not be prepared with all photos. Check the saved photos and try again.'
      : 'The email test could not start. Check the server email settings and try again.', code },
    { status: error instanceof InputError ? error.status : 503,
      headers: { ...headers, ...(error instanceof InputError && error.status === 429 ? { 'Retry-After': '60' } : {}) } });
  }
}
