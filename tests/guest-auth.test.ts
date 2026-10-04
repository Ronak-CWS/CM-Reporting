import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { guestLoginConfig, microsoftConfig, SESSION_COOKIE, validateAuthenticationConfig } from '../lib/auth-config';
import { closeAuthStore, createSession, readSession } from '../lib/auth-store';
import { logout } from '../lib/auth-handlers';
import { accessFailure, signedInUser } from '../lib/request-access';
import { createLocalStorage } from '../lib/local-storage';
import type { ReportRecord } from '../lib/report-types';

const { runtime } = vi.hoisted(() => ({ runtime: { storage: undefined as ReturnType<typeof createLocalStorage> | undefined } }));
vi.mock('../lib/local-storage', async (original) => ({
  ...await original<typeof import('../lib/local-storage')>(),
  getDatabase: () => runtime.storage!.database,
  getPhotoStorage: () => runtime.storage!.photos,
}));
vi.mock('../lib/location-catalogue-store', async () => {
  const { createLocationCatalogue } = await import('../lib/location-catalogue');
  const catalogue = createLocationCatalogue((await import('./fixtures/service-locations.json')).default);
  return { getLocationCatalogue: () => catalogue };
});

import { POST as guestLogin } from '../app/api/auth/guest/route';
import { GET as getSession } from '../app/api/auth/session/route';
import { GET as getReports, POST as submitReport, PATCH as updateReport } from '../app/api/records/route';
import { GET as getPhoto } from '../app/api/records/[id]/photos/[photoId]/route';
import { GET as getExport } from '../app/api/export/route';
import { GET as getLocations } from '../app/api/locations/route';

const origin = 'https://cm.test';
const base = `${origin}/cm-reporting`;
let root: string;
let directory: string;
let password: string;

function request(route = '/', init: RequestInit = {}, cookie = '') {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  return new Request(`${base}${route}`, { ...init, headers });
}

function loginRequest(value = password, headers: Record<string, string> = {}, cookie = '') {
  return request('/api/auth/guest', { method: 'POST', headers: { origin, ...headers }, body: new URLSearchParams({ password: value }) }, cookie);
}

async function login(cookie = '') {
  const response = await guestLogin(loginRequest(password, {}, cookie));
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/cm-reporting/');
  const token = response.cookies.get(SESSION_COOKIE)!.value;
  return { response, token, cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'cm-guest-test-')); });
afterAll(async () => {
  // Only remove the exact temporary root created by this test suite.
  if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  directory = path.join(root, randomUUID());
  password = `test-only-${randomUUID()}`;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CM_AUTH_MODE', 'microsoft');
  vi.stubEnv('CM_PUBLIC_ORIGIN', origin);
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_ENTRA_TENANT_ID', '11111111-2222-3333-4444-555555555555');
  vi.stubEnv('CM_ENTRA_CLIENT_ID', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  vi.stubEnv('CM_ENTRA_CLIENT_SECRET', 'test-only-microsoft-secret-not-a-real-credential');
  vi.stubEnv('CM_ENTRA_REQUIRED_ROLE', 'CMReporting.Access');
  vi.stubEnv('CM_DATA_DIR', directory);
  vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'true');
  vi.stubEnv('CM_GUEST_LOGIN_PASSWORD', password);
  vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', new Date(Date.now() + 24 * 3600_000).toISOString());
});
afterEach(() => {
  closeAuthStore();
  runtime.storage?.close();
  runtime.storage = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('temporary guest login', () => {
  it('is disabled by default and cannot be enabled by browser input', async () => {
    vi.stubEnv('CM_GUEST_LOGIN_ENABLED', '');
    expect(guestLoginConfig()).toBeNull();
    const response = await guestLogin(loginRequest(password, { 'x-cm-guest': 'true' }));
    expect(response.headers.get('location')).toBe('/cm-reporting/login?error=guest-unavailable');
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(accessFailure(request('/api/records'))?.status).toBe(401);
  });

  it.each([
    ['CM_GUEST_LOGIN_ENABLED', 'yes'],
    ['CM_GUEST_LOGIN_PASSWORD', 'too-short'],
    ['CM_GUEST_LOGIN_PASSWORD', '<placeholder-password-do-not-use>'],
    ['CM_GUEST_LOGIN_EXPIRES_AT', ''],
    ['CM_GUEST_LOGIN_EXPIRES_AT', 'tomorrow'],
    ['CM_GUEST_LOGIN_EXPIRES_AT', '2030-01-01T12:00:00'],
  ])('rejects invalid %s configuration without exposing its value', async (key, value) => {
    vi.stubEnv(key, value);
    expect(validateAuthenticationConfig).toThrow();
    const response = await guestLogin(loginRequest());
    expect(response.headers.get('location')).toBe('/cm-reporting/login?error=guest-unavailable');
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(await response.text()).not.toContain(password);
  });

  it('passes the real service preflight with guest access configured', async () => {
    const result = await promisify(execFile)(process.execPath, ['scripts/check-server.mjs'], {
      env: { ...process.env, CM_LOCATION_CATALOGUE_PATH: fileURLToPath(new URL('./fixtures/service-locations.json', import.meta.url)) },
    });
    expect(result.stdout).toContain('Server configuration checked.');
    expect(result.stdout).not.toContain(password);
  });

  it('creates a private, one-hour guest session without claiming a Microsoft identity', async () => {
    const result = await login();
    expect(result.token).toHaveLength(43);
    for (const attribute of ['Path=/cm-reporting', 'HttpOnly', 'Secure', 'SameSite=lax', 'Max-Age=3600']) {
      expect(result.response.headers.get('set-cookie')).toContain(attribute);
    }
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    expect(result.response.headers.get('set-cookie')).not.toContain(password);
    expect(readSession(result.token, microsoftConfig().policy)).toBeNull();
    closeAuthStore();
    const response = getSession(request('/api/auth/session', {}, result.cookie));
    expect(await response.json()).toEqual({ user: { kind: 'guest', name: 'Guest tester', username: 'Temporary test access' } });
    expect(signedInUser(request('/', {}, `${result.cookie}; ${result.cookie}`))).toBeNull();
    const rotated = await login(result.cookie);
    expect(rotated.token).not.toBe(result.token);
    expect(accessFailure(request('/', {}, result.cookie))?.status).toBe(401);
  });

  it('requires the password in a same-origin POST and keeps failed attempts unauthenticated', async () => {
    for (const suppliedOrigin of ['', 'null', 'https://untrusted.invalid']) {
      const response = await guestLogin(loginRequest(password, { origin: suppliedOrigin }));
      expect(response.status).toBe(403);
      expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    }
    expect((await guestLogin(request('/api/auth/guest'))).status).toBe(405);
    const wrong = await guestLogin(loginRequest('incorrect-password'));
    expect(wrong.headers.get('location')).toBe('/cm-reporting/login?error=guest-signin');
    expect(wrong.cookies.get(SESSION_COOKIE)).toBeUndefined();
    const duplicate = await guestLogin(request('/api/auth/guest', {
      method: 'POST', headers: { origin }, body: new URLSearchParams([['password', password], ['password', password]]),
    }));
    expect(duplicate.headers.get('location')).toBe('/cm-reporting/login?error=guest-signin');
    const oversized = await guestLogin(loginRequest('x'.repeat(3000), { 'content-length': '1' }));
    expect(oversized.headers.get('location')).toBe('/cm-reporting/login?error=guest-signin');
    const json = await guestLogin(request('/api/auth/guest', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password }),
    }));
    expect(json.headers.get('location')).toBe('/cm-reporting/login?error=guest-signin');
  });

  it('limits guessing across restarts and ignores spoofed forwarding headers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let index = 0; index < 10; index++) {
      expect((await guestLogin(loginRequest('wrong'))).headers.get('location')).toContain('error=guest-signin');
    }
    closeAuthStore();
    const blocked = await guestLogin(loginRequest(password, { 'x-forwarded-for': '192.0.2.1' }));
    expect(blocked.headers.get('location')).toContain('error=guest-rate');
    expect(blocked.headers.get('retry-after')).toBe('300');
    expect(blocked.cookies.get(SESSION_COOKIE)).toBeUndefined();
    vi.setSystemTime(Date.now() + 300_000);
    await login();
  });

  it.each(['disable', 'expiry', 'password', 'window-change', 'registration'] as const)('revokes active guest access after %s', async (change) => {
    const result = await login();
    if (change === 'disable') vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'false');
    if (change === 'expiry') {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 24 * 3600_000);
    }
    if (change === 'password') vi.stubEnv('CM_GUEST_LOGIN_PASSWORD', `replacement-test-${randomUUID()}`);
    if (change === 'window-change') vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', new Date(Date.now() + 2 * 24 * 3600_000).toISOString());
    if (change === 'registration') vi.stubEnv('CM_ENTRA_CLIENT_ID', randomUUID());
    expect(accessFailure(request('/api/records', {}, result.cookie))?.status).toBe(401);
    expect(getSession(request('/api/auth/session', {}, result.cookie)).status).toBe(401);
  });

  it('caps a session at the testing deadline and leaves expired configuration safe to start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', new Date(Date.now() + 30_000).toISOString());
    const result = await login();
    expect(result.response.headers.get('set-cookie')).toContain('Max-Age=30');
    vi.setSystemTime(Date.now() + 30_000);
    expect(guestLoginConfig()).toBeNull();
    expect(validateAuthenticationConfig).not.toThrow();
    expect(accessFailure(request('/', {}, result.cookie))?.status).toBe(401);
    expect((await guestLogin(loginRequest())).headers.get('location')).toContain('error=guest-unavailable');
  });

  it('expires guest sessions after one hour even when the testing window is longer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const result = await login();
    vi.setSystemTime(Date.now() + 3600_000);
    expect(guestLoginConfig()).not.toBeNull();
    expect(accessFailure(request('/', {}, result.cookie))?.status).toBe(401);
  });

  it('keeps existing Microsoft sessions valid when guest access is turned off', async () => {
    const user = { tenantId: microsoftConfig().tenantId, objectId: randomUUID(), name: 'Test Employee', username: 'employee@example.invalid' };
    const token = createSession(user, microsoftConfig().policy);
    vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'false');
    expect(signedInUser(request('/', {}, `${SESSION_COOKIE}=${token}`))).toEqual(user);
  });
});

it('lets an authenticated guest submit, view, update and export a report with photos and notification queuing', async () => {
  runtime.storage = createLocalStorage(directory);
  vi.stubEnv('REPORT_EMAIL_ENABLED', 'true');
  vi.stubEnv('REPORT_EMAIL_TO', 'office@example.invalid');
  const { cookie } = await login();
  const photoBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64'));
  const form = new FormData();
  form.set('report', JSON.stringify({
    recordType: 'daily', category: 'Blocked call', scope: 'street', reasonCode: 'flooding',
    registeredCommunity: 'Test community', siteAddress: 'Test Street', employeeName: 'Guest test driver',
    streetFrom: 'First Avenue', streetTo: 'Third Avenue',
  }));
  form.set('submissionId', randomUUID());
  form.append('photos', new File([photoBytes], 'guest-test.png', { type: 'image/png' }));
  const created = await submitReport(request('/api/records', { method: 'POST', headers: { origin }, body: form }, cookie));
  expect(created.status).toBe(201);
  const { record } = await created.json() as { record: ReportRecord };
  const listed = await (await getReports(request('/api/records', {}, cookie))).json() as { records: ReportRecord[] };
  expect(listed.records.map((item) => item.id)).toContain(record.id);
  expect((await getLocations(request('/api/locations?kind=community&q=Test', {}, cookie))).status).toBe(200);
  const context = { params: Promise.resolve({ id: record.id, photoId: record.photos[0].id }) };
  const photoRequest = new Request(`${origin}${record.photos[0].url}`, { headers: { cookie } });
  const photo = await getPhoto(photoRequest, context);
  expect(photo.status).toBe(200);
  expect(new Uint8Array(await photo.arrayBuffer())).toEqual(photoBytes);
  const update = { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ id: record.id, status: 'Resolved', resolutionDescription: 'Test completed' }) };
  expect((await updateReport(request('/api/records', { ...update, headers: { ...update.headers, origin: 'https://untrusted.invalid' } }, cookie))).status).toBe(403);
  expect((await updateReport(request('/api/records', update, cookie))).status).toBe(200);
  const csv = await getExport(request('/api/export?type=daily', {}, cookie));
  expect(csv.status).toBe(200);
  expect(await csv.text()).toContain(record.referenceNumber);
  const queued = await runtime.storage.database.prepare('SELECT recipient, sent_at FROM report_email_outbox WHERE report_id = ?').bind(record.id).first();
  expect(queued).toMatchObject({ recipient: 'office@example.invalid', sent_at: null });
  expect((await logout(request('/api/auth/logout', { method: 'POST', headers: { origin } }, cookie))).headers.get('location')).toContain('loggedOut=1');
  expect((await getReports(request('/api/records', {}, cookie))).status).toBe(401);
  expect((await getPhoto(photoRequest, context)).status).toBe(401);
  expect((await getExport(request('/api/export?type=daily', {}, cookie))).status).toBe(401);
});
