import { accessResponse } from '../../../../../lib/request-access';
import { InputError } from '../../../../../lib/input-error';
import { emailTestReport } from '../../../../../lib/report-email-test';
import { blockedCallAttachments } from '../../../../../lib/report-attachment.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = accessResponse(request);
  if (denied) return denied;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const { id } = await context.params;
    const { sqlite, directory } = emailTestReport(id);
    const [attachment] = await blockedCallAttachments(sqlite, directory, id);
    return new Response(new Uint8Array(attachment.content), { headers: { ...headers,
      'Content-Type': attachment.contentType, 'Content-Disposition': `attachment; filename="${attachment.filename}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Length': String(attachment.content.length) } });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : 'The report PDF could not be prepared with all photos.' },
      { status: error instanceof InputError ? error.status : 503, headers });
  }
}
