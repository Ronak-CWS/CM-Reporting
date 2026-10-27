import { driverAccessResponse, signedInDriver } from '../../../../../lib/request-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const denied = driverAccessResponse(request);
  if (denied) return denied;
  return Response.json({ user: signedInDriver(request) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
