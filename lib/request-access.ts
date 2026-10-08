import { timingSafeEqual } from 'node:crypto';
import { authenticationMode, guestLoginConfig, microsoftConfig, publicOrigin, SESSION_COOKIE } from './auth-config';
import { readSession } from './auth-store';

export function requestCookie(request: Request, name: string) {
  const matches = (request.headers.get('cookie') || '').split(';').map((value) => value.trim()).filter((value) => value.startsWith(`${name}=`));
  // Ambiguous cookies from a sibling application must not choose an identity.
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

export function signedInUser(request: Request) {
  if (authenticationMode() !== 'microsoft') return null;
  const token = requestCookie(request, SESSION_COOKIE);
  const employee = readSession(token, microsoftConfig().policy);
  if (employee) return employee;
  const guest = guestLoginConfig();
  const session = guest ? readSession(token, guest.policy) : null;
  return session?.kind === 'guest' ? session : null;
}

// Use only after the request has passed accessFailure/accessResponse.
// Blocked-call authors come from the server's identity, never form fields.
export function reportAuthorName(request: Request) {
  const mode = authenticationMode();
  if (mode === 'development') return 'Local development';
  if (mode === 'proxy' && !proxyFailure(request)) return request.headers.get('x-cm-user')!.trim().slice(0, 250);
  const user = signedInUser(request);
  if (!user) throw new Error('Sign in before submitting a report.');
  return (user.name.trim() || user.username.trim()).slice(0, 250);
}

export function mutationFailure(request: Request): { status: number; error: string } | null {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== publicOrigin()) {
    return { status: 403, error: 'Submit reports from the company reporting portal.' };
  }
  return null;
}

function proxyFailure(request: Request) {
  const secret = process.env.CM_TRUSTED_PROXY_KEY;
  if (!secret || secret.length < 32) return { status: 503, error: 'Private server access is not configured.' };
  const received = request.headers.get('x-cm-proxy-key') || '';
  const expectedBytes = Buffer.from(secret);
  const receivedBytes = Buffer.from(received);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes) || !request.headers.get('x-cm-user')?.trim()) {
    return { status: 401, error: 'Sign in through the company reporting portal.' };
  }
  return null;
}

export function accessFailure(request: Request): { status: number; error: string } | null {
  try {
    const mode = authenticationMode();
    if (mode === 'development') return null;
    publicOrigin();
    if (mode === 'proxy') {
      const failure = proxyFailure(request);
      if (failure) return failure;
    } else if (!signedInUser(request)) {
      return { status: 401, error: 'Your session has ended. Sign in to CM Reporting to continue.' };
    }
    return mutationFailure(request);
  } catch {
    return { status: 503, error: 'Reporting sign-in is not available. Please contact the office.' };
  }
}

// Data routes enforce access themselves as well as through the Next request proxy.
export function accessResponse(request: Request) {
  const failure = accessFailure(request);
  return failure ? Response.json({ error: failure.error }, { status: failure.status, headers: { 'Cache-Control': 'private, no-store' } }) : null;
}
