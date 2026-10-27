import { createHash, timingSafeEqual } from 'node:crypto';

// Accept a bounded native form only. Passwords never go in URLs, cookies or logs.
export async function passwordMatches(request: Request, expectedDigest: Buffer) {
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded' || Number(request.headers.get('content-length')) > 2048) return false;
  let received = 0;
  const bounded = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > 2048) throw new Error('Sign-in form is too large.');
      controller.enqueue(chunk);
    },
  }));
  try {
    const form = new URLSearchParams(await new Response(bounded).text());
    if (form.getAll('password').length !== 1) return false;
    const password = form.get('password') || '';
    return password.length <= 128 && timingSafeEqual(createHash('sha256').update(password).digest(), expectedDigest);
  } catch {
    return false;
  }
}
