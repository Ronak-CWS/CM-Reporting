import { driverAccessResponse } from '../../../lib/request-access';
import { InputError } from '../../../lib/input-error';
import { readReportBody } from '../../../lib/request-body';
import { submitBlockedCall } from '../../../lib/blocked-call-submission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = driverAccessResponse(request);
  if (denied) return denied;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const { payload, files, submissionId } = await readReportBody(request);
    if (payload?.recordType !== 'daily') throw new InputError('Driver access is limited to blocked-call submissions.');
    // Shared-password submissions use a generic label and ignore browser-supplied names.
    const record = await submitBlockedCall({ ...payload, employeeName: 'Driver' }, files, submissionId);
    // Return a receipt only, including on retries after office staff update a report.
    return Response.json({ receipt: {
      id: record.id, referenceNumber: record.referenceNumber,
      registeredCommunity: record.registeredCommunity, siteAddress: record.siteAddress,
      photoCount: record.photos.length,
    } }, { status: 201, headers });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error('Driver submission failed.', error instanceof Error ? error.name : 'Unknown error');
    return Response.json({ error: 'The report could not be saved. Your entries are still here; please try again.' }, { status: 500, headers });
  }
}
