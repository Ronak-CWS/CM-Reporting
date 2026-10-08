import { NextResponse, type NextRequest } from 'next/server';
import { accessFailure } from './lib/request-access';
import { basePath } from './lib/app-path.js';
import { publicOrigin } from './lib/auth-config';
import { withReturnTo } from './lib/auth-navigation';

const publicPaths = new Set([
  '/login', '/api/auth/microsoft/start', '/api/auth/microsoft/callback', '/api/auth/guest', '/api/auth/logout',
  '/collective-waste-solutions.png', '/collective-icon.png', '/Circular Materials Logo - Colour (1).png',
]);

export function proxy(request: NextRequest) {
  const prefix = basePath();
  const incoming = request.nextUrl.pathname;
  const pathname = (prefix && incoming.startsWith(`${prefix}/`) ? incoming.slice(prefix.length) : incoming).replace(/\/$/, '') || '/';
  let publicPath = pathname;
  try { publicPath = decodeURIComponent(pathname); } catch { /* Malformed escapes are not a public path. */ }
  const failure = publicPaths.has(publicPath) ? null : accessFailure(request);
  if (failure) {
    if ([401, 503].includes(failure.status) && !pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)) {
      try {
        // Next's proxy adapter requires an absolute URL. Use the configured
        // public origin because IIS can forward a loopback or untrusted Host.
        const response = NextResponse.redirect(new URL(withReturnTo('/login', pathname), publicOrigin()), 303);
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
      } catch {
        return NextResponse.json({ error: 'Reporting sign-in is not available. Please contact the office.' }, {
          status: 503, headers: { 'Cache-Control': 'private, no-store' },
        });
      }
    }
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Native guest-login and sign-out POSTs need a non-null Origin for CSRF checks.
  // Keep referrers within this origin; auth redirects separately use no-referrer.
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
