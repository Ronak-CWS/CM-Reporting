import 'next/dist/server/node-environment';
import { adapter } from 'next/dist/server/web/adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '../proxy';

// The real Next adapter validates Location after proxy() returns. Calling the
// proxy directly misses the runtime error caused by a relative redirect URL.
async function handle(url: string, method = 'GET', headers: Record<string, string> = {}) {
  const result = await adapter({
    page: '/proxy',
    request: {
      url, method, headers, signal: new AbortController().signal,
      nextConfig: { basePath: process.env.NEXT_PUBLIC_BASE_PATH || '' },
    },
    handler: async (request) => proxy(request),
  });
  await result.waitUntil;
  return result.response;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CM_AUTH_MODE', 'microsoft');
  vi.stubEnv('CM_PUBLIC_ORIGIN', 'https://cm.test');
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_ENTRA_TENANT_ID', '11111111-2222-3333-4444-555555555555');
  vi.stubEnv('CM_ENTRA_CLIENT_ID', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  vi.stubEnv('CM_ENTRA_CLIENT_SECRET', 'test-only-client-secret-not-a-real-credential');
});
afterEach(() => vi.unstubAllEnvs());

describe('sign-in redirects through the Next request adapter', () => {
  it.each([
    ['GET', '/cm-reporting'],
    ['GET', '/cm-reporting/'],
    ['HEAD', '/cm-reporting/'],
  ])('redirects %s %s from the IIS upstream to the public login URL', async (method, pathname) => {
    const response = await handle(`http://127.0.0.1:3013${pathname}`, method);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://cm.test/cm-reporting/login');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('redirects the local development root without a base path', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CM_PUBLIC_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    const url = 'http://localhost:3000/';
    const response = await handle(url);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!, url).href).toBe('http://localhost:3000/login');
  });

  it('uses the configured origin even when request headers supply another host', async () => {
    const response = await handle('http://127.0.0.1:3013/cm-reporting/?returnTo=https://untrusted.invalid', 'GET', {
      host: 'untrusted.invalid', 'x-forwarded-host': 'untrusted.invalid', 'x-forwarded-proto': 'http',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://cm.test/cm-reporting/login');
  });

  it.each(['', 'https://cm.test/wrong-path'])('returns a safe configuration error when the public origin is %j', async (origin) => {
    vi.stubEnv('CM_PUBLIC_ORIGIN', origin);
    const response = await handle('http://127.0.0.1:3013/cm-reporting/');
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'Reporting sign-in is not available. Please contact the office.' });
  });

  it('keeps the login page public and returns an authentication error for protected APIs', async () => {
    const login = await handle('http://127.0.0.1:3013/cm-reporting/login');
    expect(login.headers.get('x-middleware-next')).toBe('1');
    expect(login.headers.get('location')).toBeNull();
    const api = await handle('http://127.0.0.1:3013/cm-reporting/api/records');
    expect(api.status).toBe(401);
    expect(api.headers.get('location')).toBeNull();
  });

  it.each(['/login', '/'])('preserves the origin on native forms served from %s', async (pathname) => {
    vi.stubEnv('CM_AUTH_MODE', 'proxy');
    const key = 'test-only-proxy-key-at-least-32-characters';
    vi.stubEnv('CM_TRUSTED_PROXY_KEY', key);
    const response = await handle(`http://127.0.0.1:3013/cm-reporting${pathname}`, 'GET', {
      'x-cm-proxy-key': key, 'x-cm-user': 'Test employee',
    });
    expect(response.headers.get('x-middleware-next')).toBe('1');
    // Fetch's Origin-header algorithm turns a native POST's origin into null
    // under no-referrer. Both guest login and dashboard sign-out are forms.
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });
});
