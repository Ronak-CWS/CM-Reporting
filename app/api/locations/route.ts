import { NextResponse } from 'next/server';
import type { LocationKind } from '../../../lib/location-catalogue';
import { getLocationCatalogue } from '../../../lib/location-catalogue-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind') || 'community';
  const query = params.get('q') || '';
  const community = params.get('community') || '';
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!['community', 'address', 'street'].includes(kind) || query.length > 500 || community.length > 250) {
    return NextResponse.json({ error: 'The location search is invalid.' }, { status: 400, headers });
  }
  const locationCatalogue = getLocationCatalogue();
  if (!locationCatalogue.available) {
    return NextResponse.json({ error: 'The service address list is not available. Please contact the office.' }, { status: 503, headers });
  }
  return NextResponse.json(locationCatalogue.search(kind as LocationKind, query, community), { headers });
}
