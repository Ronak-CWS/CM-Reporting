export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST() {
  return Response.json({ error: 'Guest login has been removed. Sign in with Microsoft.' }, {
    status: 410, headers: { 'Cache-Control': 'private, no-store' },
  });
}
