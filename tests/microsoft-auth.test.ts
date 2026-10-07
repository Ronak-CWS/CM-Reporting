import { generateKeyPairSync, randomUUID, sign, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { microsoftConfig, FLOW_COOKIE, SESSION_COOKIE, SESSION_SECONDS } from '../lib/auth-config';
import { closeAuthStore, readSession } from '../lib/auth-store';
import { startMicrosoftLogin, microsoftCallback, logout } from '../lib/auth-handlers';
import { accessFailure, requestCookie } from '../lib/request-access';
import { proxy } from '../proxy';
import { GET as getReports, POST as createReport, PATCH as updateReport } from '../app/api/records/route';
import { GET as getPhoto } from '../app/api/records/[id]/photos/[photoId]/route';
import { GET as getExport } from '../app/api/export/route';
import { GET as getLocations } from '../app/api/locations/route';
import { GET as getSession } from '../app/api/auth/session/route';

const tenantId = '11111111-2222-3333-4444-555555555555';
const objectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const origin = 'https://cm.test';
const base = `${origin}/cm-reporting`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
let directory: string;
let nonce = '';
let expectedChallenge = '';
let claimsOverride: Record<string, unknown> = {};
let badSignature = false;
let fetchMock: ReturnType<typeof vi.fn>;
let tokenRequests: URLSearchParams[];
let accessLog: ReturnType<typeof vi.fn>;

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const settings = microsoftConfig();
  const claims = {
    iss: settings.issuer, aud: settings.clientId, sub: 'employee-subject', tid: tenantId, oid: objectId,
    acct: 0, roles: ['CMReporting.Access'], name: 'Test Employee', preferred_username: 'employee@example.invalid',
    iat: now, exp: now + 3600, nonce, ...claimsOverride,
  };
  const signingInput = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  if (badSignature) signature[0] ^= 255;
  return `${signingInput}.${signature.toString('base64url')}`;
}

function request(route: string, cookie = '', method = 'GET', headers: Record<string, string> = {}) {
  return new Request(`${base}${route}`, { method, headers: { cookie, ...headers } });
}

async function begin() {
  const response = await startMicrosoftLogin(request('/api/auth/microsoft/start'));
  expect(response.status).toBe(303);
  const url = new URL(response.headers.get('location')!);
  nonce = url.searchParams.get('nonce')!;
  expectedChallenge = url.searchParams.get('code_challenge')!;
  const cookie = `${FLOW_COOKIE}=${response.cookies.get(FLOW_COOKIE)!.value}`;
  return { response, url, cookie, callback: `/api/auth/microsoft/callback?code=test-code&state=${url.searchParams.get('state')}` };
}

async function login() {
  const flow = await begin();
  const response = await microsoftCallback(request(flow.callback, flow.cookie));
  expect(response.headers.get('location')).toBe('/cm-reporting/');
  const token = response.cookies.get(SESSION_COOKIE)!.value;
  return { ...flow, response, token, sessionCookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'cm-sso-test-')); });
afterAll(async () => {
  closeAuthStore();
  // The target is the exact directory returned by mkdtemp, never a computed parent.
  if (directory) await rm(directory, { recursive: true, force: true });
});
afterEach(() => { closeAuthStore(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
beforeEach(() => {
  accessLog = vi.fn();
  vi.spyOn(console, 'warn').mockImplementation(accessLog);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CM_AUTH_MODE', 'microsoft');
  vi.stubEnv('CM_PUBLIC_ORIGIN', origin);
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_ENTRA_TENANT_ID', tenantId);
  vi.stubEnv('CM_ENTRA_CLIENT_ID', randomUUID());
  vi.stubEnv('CM_ENTRA_CLIENT_SECRET', 'test-only-client-secret-not-a-real-credential');
  vi.stubEnv('CM_ENTRA_REQUIRED_ROLE', 'CMReporting.Access');
  vi.stubEnv('CM_DATA_DIR', directory);
  claimsOverride = {};
  badSignature = false;
  tokenRequests = [];
  fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'login.microsoftonline.com') throw new Error('Unexpected external request.');
    const settings = microsoftConfig();
    if (url.pathname.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: settings.issuer,
      authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      token_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      jwks_uri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      response_types_supported: ['code'], subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
    if (url.pathname.endsWith('/keys')) return Response.json({ keys: [jwk] });
    if (url.pathname.endsWith('/token')) {
      const body = new URLSearchParams(String(init?.body));
      tokenRequests.push(body);
      expect(body.get('client_secret')).toBe(settings.clientSecret);
      expect(body.get('redirect_uri')).toBe(`${base}/api/auth/microsoft/callback`);
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(expectedChallenge);
      return Response.json({ token_type: 'Bearer', access_token: 'test-api-token-never-a-session', expires_in: 3600, id_token: jwt() });
    }
    throw new Error(`Unexpected Microsoft endpoint: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('Microsoft authorization code login', () => {
  it('uses minimal scopes, PKCE, nonce, state and a path-scoped HttpOnly cookie', async () => {
    const { response, url } = await begin();
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe(`/${tenantId}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/microsoft/callback`);
    expect(url.searchParams.get('state')).toHaveLength(43);
    expect(url.searchParams.get('nonce')).toHaveLength(43);
    for (const attribute of ['Path=/cm-reporting', 'HttpOnly', 'Secure', 'SameSite=lax']) {
      expect(response.headers.get('set-cookie')).toContain(attribute);
    }
    expect(url.href).not.toContain('client_secret');
    expect(url.searchParams.get('prompt')).toBeNull(); // Reuse the employee's existing Microsoft SSO session.
  });

  it('validates a signed ID token, persists the employee session and consumes callbacks only once', async () => {
    const result = await login();
    expect(tokenRequests).toHaveLength(1);
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    expect(result.response.cookies.get(FLOW_COOKIE)?.value).toBe('');
    closeAuthStore(); // Emulates reopening the SQLite store after a process restart.
    expect(readSession(result.token, microsoftConfig().policy)).toEqual({ tenantId, objectId, name: 'Test Employee', username: 'employee@example.invalid' });
    expect(accessFailure(request('/api/records', result.sessionCookie))).toBeNull();
    expect(accessLog).not.toHaveBeenCalled();
    const replay = await microsoftCallback(request(result.callback, result.cookie));
    expect(replay.headers.get('location')).toBe('/cm-reporting/login?error=signin');
    expect(tokenRequests).toHaveLength(1);
  });

  it.each([
    ['wrong audience', { aud: 'other-application' }],
    ['wrong issuer', { iss: 'https://untrusted.invalid' }],
    ['expired token', { exp: 1 }],
    ['future token', { nbf: 9999999999 }],
    ['wrong nonce', { nonce: 'unbound-nonce' }],
    ['missing nonce', { nonce: undefined }],
  ])('rejects %s before creating a session', async (_label, override) => {
    const flow = await begin();
    claimsOverride = override;
    const response = await microsoftCallback(request(flow.callback, flow.cookie));
    expect(response.headers.get('location')).toBe('/cm-reporting/login?error=signin');
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(accessLog).not.toHaveBeenCalled();
  });

  it('rejects a forged ID-token signature', async () => {
    const flow = await begin();
    badSignature = true;
    const response = await microsoftCallback(request(flow.callback, flow.cookie));
    expect(response.headers.get('location')).toBe('/cm-reporting/login?error=signin');
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(accessLog).not.toHaveBeenCalled();
  });

  it.each([
    ['another tenant', { tid: '99999999-2222-3333-4444-555555555555' }, ['tenant_mismatch']],
    ['a guest account', { acct: 1 }, ['guest_account']],
    ['a string guest claim', { acct: '1' }, ['guest_account']],
    ['a missing membership claim', { acct: undefined }, ['member_claim_missing']],
    ['an invalid membership claim', { acct: 'unexpected' }, ['member_claim_invalid']],
    ['an unassigned account', { roles: [] }, ['app_role_missing']],
    ['missing roles', { roles: undefined }, ['app_role_missing']],
    ['an unrelated application role', { roles: ['ReportsDashboard.Access'] }, ['app_role_missing']],
    ['a missing object ID', { oid: undefined }, ['object_id_invalid']],
    ['both missing member and role claims', { acct: undefined, roles: undefined }, ['member_claim_missing', 'app_role_missing']],
  ])('denies %s and logs only fixed diagnostic codes', async (_label, override, reasons) => {
    const flow = await begin();
    claimsOverride = override;
    const response = await microsoftCallback(request(flow.callback, flow.cookie));
    expect(response.headers.get('location')).toBe('/cm-reporting/login?error=access');
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(accessLog).toHaveBeenCalledTimes(1);
    expect(accessLog).toHaveBeenCalledWith(`[CMReporting SSO] ${JSON.stringify({ event: 'access_denied', reasons, requiredRole: 'CMReporting.Access' })}`);
    // Exact diagnostic shape above excludes all token and identity values.
    expect(JSON.stringify(accessLog.mock.calls)).not.toContain('test-code');
    expect(JSON.stringify(accessLog.mock.calls)).not.toContain('employee@example.invalid');
    expect(JSON.stringify(accessLog.mock.calls)).not.toContain(objectId);
  });

  it('accepts a string member claim without emitting denial diagnostics', async () => {
    claimsOverride = { acct: '0' };
    await login();
    expect(accessLog).not.toHaveBeenCalled();
  });

  it('distinguishes changed sign-in configuration before exchanging a code', async () => {
    const flow = await begin();
    vi.stubEnv('CM_ENTRA_REQUIRED_ROLE', 'CMReporting.OtherAccess');
    const response = await microsoftCallback(request(flow.callback, flow.cookie));
    expect(response.headers.get('location')).toBe('/cm-reporting/login?error=access');
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(tokenRequests).toHaveLength(0);
    expect(accessLog).toHaveBeenCalledWith('[CMReporting SSO] {"event":"access_denied","reasons":["signin_configuration_changed"],"requiredRole":"CMReporting.OtherAccess"}');
  });

  it('rejects missing browser cookies, wrong state, expired flows and duplicate state before exchanging a code', async () => {
    const flow = await begin();
    for (const [callback, cookie] of [[flow.callback, ''], [flow.callback.replace(/state=.*/, 'state=wrong'), flow.cookie], [`${flow.callback}&state=duplicate`, flow.cookie]]) {
      const response = await microsoftCallback(request(callback, cookie));
      expect(response.headers.get('location')).toBe('/cm-reporting/login?error=signin');
    }
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const expired = await microsoftCallback(request(flow.callback, flow.cookie));
    expect(expired.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(tokenRequests).toHaveLength(0);
  });

  it('ignores supplied redirect targets and Host headers, including callback host rewriting by IIS', async () => {
    const flow = await begin();
    const callback = new Request(`http://127.0.0.1:3013/cm-reporting${flow.callback}&returnTo=https://attacker.invalid`, { headers: { cookie: flow.cookie, host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid' } });
    const result = await microsoftCallback(callback);
    expect(result.headers.get('location')).toBe('/cm-reporting/');
  });

  it('returns only a safe message when Microsoft cancels sign-in', async () => {
    const flow = await begin();
    const callback = flow.callback.replace('code=test-code', 'error=access_denied&error_description=do-not-display-this');
    const result = await microsoftCallback(request(callback, flow.cookie));
    expect(result.headers.get('location')).toBe('/cm-reporting/login?error=signin');
    expect(tokenRequests).toHaveLength(0);
    expect(accessLog).not.toHaveBeenCalled();
  });
});

describe('local sessions and protected reporting routes', () => {
  it('rejects forged cookies and identity/proxy headers', async () => {
    expect(accessFailure(request('/api/records', `${SESSION_COOKIE}=${'x'.repeat(43)}`, 'GET', {
      'x-cm-user': 'administrator', 'x-cm-proxy-key': 'forged', authorization: 'Bearer test-api-token-never-a-session',
    }))?.status).toBe(401);
    expect(requestCookie(request('/', `${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`), SESSION_COOKIE)).toBe('');
  });

  it('checks auth inside every data handler, independent of middleware', async () => {
    const responses = await Promise.all([
      getReports(request('/api/records')), createReport(request('/api/records', '', 'POST')),
      updateReport(request('/api/records', '', 'PATCH')), getExport(request('/api/export')),
      getLocations(request('/api/locations')), getSession(request('/api/auth/session')),
      getPhoto(request('/api/records/r/photos/p'), { params: Promise.resolve({ id: 'r', photoId: 'p' }) }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });

  it('protects mutations from cross-site requests and revokes the session at logout', async () => {
    const { token, sessionCookie } = await login();
    expect(accessFailure(request('/api/records', sessionCookie, 'POST'))?.status).toBe(403);
    expect(accessFailure(request('/api/records', sessionCookie, 'PATCH', { origin: 'https://attacker.invalid' }))?.status).toBe(403);
    expect(accessFailure(request('/api/records', sessionCookie, 'POST', { origin }))).toBeNull();
    expect((await logout(request('/api/auth/logout', sessionCookie, 'POST', { origin: 'https://attacker.invalid' }))).status).toBe(403);
    expect(readSession(token, microsoftConfig().policy)).not.toBeNull();
    const result = await logout(request('/api/auth/logout', sessionCookie, 'POST', { origin }));
    expect(result.headers.get('location')).toBe('/cm-reporting/login?loggedOut=1');
    expect(result.cookies.get(SESSION_COOKIE)?.value).toBe('');
    expect(accessFailure(request('/api/records', sessionCookie))?.status).toBe(401);
  });

  it('expires sessions and invalidates sessions when the registration/access policy changes', async () => {
    const { sessionCookie } = await login();
    vi.stubEnv('CM_ENTRA_REQUIRED_ROLE', 'CMReporting.OtherAccess');
    expect(accessFailure(request('/api/records', sessionCookie))?.status).toBe(401);
    vi.stubEnv('CM_ENTRA_REQUIRED_ROLE', 'CMReporting.Access');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (SESSION_SECONDS + 1) * 1000);
    expect(accessFailure(request('/api/records', sessionCookie))?.status).toBe(401);
  });

  it('never enables development bypass or HTTP cookies in production', () => {
    vi.stubEnv('CM_AUTH_MODE', 'development');
    expect(accessFailure(request('/api/records'))?.status).toBe(503);
    vi.stubEnv('CM_AUTH_MODE', 'microsoft');
    vi.stubEnv('CM_PUBLIC_ORIGIN', 'http://cm.test');
    expect(accessFailure(request('/api/records'))?.status).toBe(503);
  });

  it('allows login/callback/branding through the proxy and redirects pages while returning JSON for APIs', () => {
    for (const route of ['/login', '/api/auth/microsoft/start', '/api/auth/microsoft/callback', '/collective-waste-solutions.png', '/Circular%20Materials%20Logo%20-%20Colour%20(1).png']) {
      expect(proxy(new NextRequest(`${base}${route}`)).headers.get('x-middleware-next')).toBe('1');
    }
    expect(proxy(new NextRequest(`${base}/`)).headers.get('location')).toBe(`${base}/login`);
    expect(proxy(new NextRequest(`${base}/api/records`)).status).toBe(401);
  });

  it('validates the Microsoft production startup configuration without starting a server', async () => {
    const result = await promisify(execFile)(process.execPath, ['scripts/check-server.mjs'], {
      env: { ...process.env, CM_LOCATION_CATALOGUE_PATH: fileURLToPath(new URL('./fixtures/service-locations.json', import.meta.url)) },
    });
    expect(result.stdout).toContain('Server configuration checked.');
  });
});
