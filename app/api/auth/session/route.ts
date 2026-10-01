import { accessResponse, signedInUser } from '../../../../lib/request-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  return Response.json({ user: signedInUser(request) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
