import { NextResponse } from 'next/server';
import { accessResponse } from '../../../lib/request-access';
import type { LocationKind } from '../../../lib/location-catalogue';
import { getLocationCatalogue } from '../../../lib/location-catalogue-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = accessResponse(request, true);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind') || 'community';
  const query = params.get('q') || '';
  const community = params.get('community') || '';
  const scope = params.get('scope') || 'pickup';
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!['community', 'address', 'street', 'location'].includes(kind) || query.length > 500 || community.length > 250 || (kind === 'location' && !['pickup', 'street'].includes(scope))) {
    return NextResponse.json({ error: 'The location search is invalid.' }, { status: 400, headers });
  }
  const locationCatalogue = getLocationCatalogue();
  if (!locationCatalogue.available) {
    return NextResponse.json({ error: 'The service address list is not available. Please contact the office.' }, { status: 503, headers });
  }
  const result = kind === 'location'
    ? locationCatalogue.searchLocations(query, scope as 'pickup' | 'street')
    : locationCatalogue.search(kind as LocationKind, query, community);
  return NextResponse.json(result, { headers });
}
