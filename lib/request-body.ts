import { InputError } from './input-error';
import { MAX_TOTAL_PHOTO_BYTES } from './photo-validation';

export async function readReportBody(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  const multipart = contentType.toLowerCase().startsWith('multipart/form-data');
  if (!multipart && !contentType.toLowerCase().startsWith('application/json')) {
    throw new InputError('Use a report form to submit this record.', 415);
  }
  const limit = multipart ? MAX_TOTAL_PHOTO_BYTES + 128 * 1024 : 64 * 1024;
  if (Number(request.headers.get('content-length')) > limit) {
    throw new InputError('The upload is too large. Keep photos under 30 MB in total.', 413);
  }
  let received = 0;
  const bounded = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > limit) throw new InputError('The upload is too large. Keep photos under 30 MB in total.', 413);
      controller.enqueue(chunk);
    },
  }));
  const body = new Response(bounded, { headers: { 'Content-Type': contentType } });
  try {
    if (!multipart) return { payload: await body.json(), files: [] as File[], submissionId: '' };
    const form = await body.formData();
    const report = form.get('report');
    if (typeof report !== 'string' || report.length > 16000) throw new InputError('The report details are invalid.');
    const files = form.getAll('photos');
    if (files.some((file) => typeof file === 'string')) throw new InputError('Choose image files for photo evidence.');
    return { payload: JSON.parse(report), files: files as File[], submissionId: String(form.get('submissionId') ?? '') };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(received > limit ? 'The upload is too large.' : 'The upload could not be read. Try again.', received > limit ? 413 : 400);
  }
}
