import { readReportPhoto } from '../../../../../../lib/reporting-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await context.params;
  try {
    const result = await readReportPhoto(id, photoId);
    if (!result) return new Response('Photo not found.', { status: 404 });
    const download = new URL(request.url).searchParams.has('download');
    return new Response(result.object.body, {
      headers: {
        'Content-Type': result.photo.contentType,
        'Content-Length': String(result.photo.size),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(result.photo.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('This photo is temporarily unavailable. Try again.', { status: 503 });
  }
}
