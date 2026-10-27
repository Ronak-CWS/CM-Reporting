import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { driverLoginConfig, DRIVER_SESSION_COOKIE, DRIVER_SESSION_SECONDS, microsoftConfig, SESSION_COOKIE, validateAuthenticationConfig } from '../lib/auth-config';
import { closeAuthStore, createSession, readSession } from '../lib/auth-store';
import { signedInDriver, signedInUser } from '../lib/request-access';
import { createLocalStorage } from '../lib/local-storage';
import type { ReportRecord } from '../lib/report-types';
import { proxy } from '../proxy';

const { runtime } = vi.hoisted(() => ({ runtime: { storage: undefined as ReturnType<typeof createLocalStorage> | undefined } }));
vi.mock('../lib/local-storage', async (original) => ({
  ...await original<typeof import('../lib/local-storage')>(),
  getDatabase: () => runtime.storage!.database,
  getPhotoStorage: () => runtime.storage!.photos,
}));
vi.mock('../lib/location-catalogue-store', async () => {
  const { createLocationCatalogue } = await import('../lib/location-catalogue');
  return { getLocationCatalogue: () => createLocationCatalogue(locations) };
});
import locations from './fixtures/service-locations.json';
import { POST as driverLogin } from '../app/api/auth/driver/route';
import { POST as driverLogout } from '../app/api/auth/driver/logout/route';
import { GET as driverSession } from '../app/api/auth/driver/session/route';
import { GET as officeSession } from '../app/api/auth/session/route';
import { POST as submitDriverReport } from '../app/api/blocked-call/route';
import { GET as getReports, POST as submitOfficeReport, PATCH as updateReport } from '../app/api/records/route';
import { GET as getPhoto } from '../app/api/records/[id]/photos/[photoId]/route';
import { GET as getExport } from '../app/api/export/route';
import { GET as getLocations } from '../app/api/locations/route';

const origin = 'https://cm.test';
const base = `${origin}/cm-reporting`;
let root: string;
let directory: string;
let password: string;

function request(route: string, init: RequestInit = {}, cookie = '') {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  return new Request(`${base}${route}`, { ...init, headers });
}

function loginRequest(value = password, headers: Record<string, string> = {}, cookie = '') {
  return request('/api/auth/driver', { method: 'POST', headers: { origin, ...headers }, body: new URLSearchParams({ password: value }) }, cookie);
}

async function login(cookie = '') {
  const response = await driverLogin(loginRequest(password, {}, cookie));
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/cm-reporting/blocked-call');
  const token = response.cookies.get(DRIVER_SESSION_COOKIE)!.value;
  return { response, token, cookie: `${DRIVER_SESSION_COOKIE}=${token}` };
}

function officeCookie() {
  const settings = microsoftConfig();
  return `${SESSION_COOKIE}=${createSession({ tenantId: settings.tenantId, objectId: randomUUID(), name: 'Office employee', username: 'office@example.invalid' }, settings.policy)}`;
}

const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64');
function reportForm(id = randomUUID(), changes = {}, includePhoto = true) {
  const form = new FormData();
  form.set('report', JSON.stringify({
    recordType: 'daily', category: 'Blocked call', scope: 'street', reasonCode: 'flooding',
    registeredCommunity: 'Test community', siteAddress: 'Test Street', serviceType: 'Waste',
    ...changes,
  }));
  form.set('submissionId', id);
  if (includePhoto) form.append('photos', new File([photoBytes], 'blockage.png', { type: 'image/png' }));
  return form;
}

beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'cm-driver-test-')); });
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
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
  vi.stubEnv('CM_DATA_DIR', directory);
  vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', password);
  vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'false');
});
afterEach(() => {
  closeAuthStore();
  runtime.storage?.close();
  runtime.storage = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('driver password sessions', () => {
  it('is disabled without a password and fails closed for invalid configuration', async () => {
    vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', '');
    expect(driverLoginConfig()).toBeNull();
    expect((await driverLogin(loginRequest())).headers.get('location')).toContain('error=unavailable');
    expect(driverSession(request('/api/auth/driver/session')).status).toBe(401);
    for (const value of ['short', 'x'.repeat(129), '<replace-with-a-real-password>']) {
      vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', value);
      expect(validateAuthenticationConfig).toThrow('CM_DRIVER_LOGIN_PASSWORD');
      const denied = await driverLogin(loginRequest());
      expect(denied.cookies.get(DRIVER_SESSION_COOKIE)).toBeUndefined();
      expect(await denied.text()).not.toContain(value);
    }
  });

  it('uses a separate private 12-hour cookie that survives restarts and rotates on login', async () => {
    const result = await login();
    for (const attribute of ['Path=/cm-reporting', 'HttpOnly', 'Secure', 'SameSite=lax', 'Max-Age=43200']) {
      expect(result.response.headers.get('set-cookie')).toContain(attribute);
    }
    expect(result.response.headers.get('set-cookie')).not.toContain(password);
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    expect(readSession(result.token, microsoftConfig().policy)).toBeNull();
    closeAuthStore();
    expect(driverSession(request('/api/auth/driver/session', {}, result.cookie)).status).toBe(200);
    expect(signedInDriver(request('/blocked-call', {}, `${result.cookie}; ${result.cookie}`))).toBeNull();
    const rotated = await login(result.cookie);
    expect(rotated.token).not.toBe(result.token);
    expect(driverSession(request('/api/auth/driver/session', {}, result.cookie)).status).toBe(401);
    expect(signedInUser(request('/', {}, `${SESSION_COOKIE}=${rotated.token}`))).toBeNull();
  });

  it('works independently of Microsoft configuration and the temporary guest window', async () => {
    vi.stubEnv('CM_ENTRA_CLIENT_SECRET', '');
    vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', '2000-01-01T00:00:00Z');
    const { cookie } = await login();
    expect(driverSession(request('/api/auth/driver/session', {}, cookie)).status).toBe(200);
    expect((await getLocations(request('/api/locations?kind=community&q=Test', {}, cookie))).status).toBe(200);
    expect(proxy(new NextRequest(`${base}/blocked-call`, { headers: { cookie } })).headers.get('x-middleware-next')).toBe('1');
    expect(officeSession(request('/api/auth/session', {}, cookie)).status).toBe(503);
  });

  it('accepts only bounded same-origin password forms', async () => {
    for (const suppliedOrigin of ['', 'null', 'https://untrusted.invalid']) {
      expect((await driverLogin(loginRequest(password, { origin: suppliedOrigin }))).status).toBe(403);
    }
    expect((await driverLogin(request('/api/auth/driver'))).status).toBe(405);
    const attempts = [
      loginRequest('wrong'),
      loginRequest('x'.repeat(3000), { 'content-length': '1' }),
      request('/api/auth/driver', { method: 'POST', headers: { origin }, body: new URLSearchParams([['password', password], ['password', password]]) }),
      request('/api/auth/driver', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password }) }),
    ];
    for (const attempt of attempts) {
      const response = await driverLogin(attempt);
      expect(response.headers.get('location')).toContain('error=signin');
      expect(response.cookies.get(DRIVER_SESSION_COOKIE)).toBeUndefined();
    }
  });

  it('limits failed guesses across restarts without counting successful shift logins', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let index = 0; index < 12; index++) await login();
    for (let index = 0; index < 10; index++) await driverLogin(loginRequest('wrong'));
    closeAuthStore();
    const blocked = await driverLogin(loginRequest(password, { 'x-forwarded-for': '192.0.2.99' }));
    expect(blocked.headers.get('location')).toContain('error=rate');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    vi.advanceTimersByTime(5 * 60_000 + 1000);
    await login();
  });

  it.each(['password', 'disable', 'expiry'])('rejects driver sessions after %s without changing office sessions', async (change) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const office = officeCookie();
    const { cookie } = await login(office);
    expect(driverSession(request('/api/auth/driver/session', {}, cookie)).status).toBe(200);
    if (change === 'password') vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', `replacement-${randomUUID()}`);
    if (change === 'disable') vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', '');
    if (change === 'expiry') vi.advanceTimersByTime(DRIVER_SESSION_SECONDS * 1000 + 1000);
    expect(driverSession(request('/api/auth/driver/session', {}, cookie)).status).toBe(401);
    expect(officeSession(request('/api/auth/session', {}, office)).status).toBe(200);
  });

  it('signs out only the driver session and requires a same-origin POST', async () => {
    const office = officeCookie();
    const { cookie } = await login(office);
    const both = `${office}; ${cookie}`;
    expect((await driverLogout(request('/api/auth/driver/logout', {}, both))).status).toBe(405);
    expect((await driverLogout(request('/api/auth/driver/logout', { method: 'POST' }, both))).status).toBe(403);
    const result = await driverLogout(request('/api/auth/driver/logout', { method: 'POST', headers: { origin } }, both));
    expect(result.headers.get('location')).toBe('/cm-reporting/blocked-call/login?loggedOut=1');
    expect(result.cookies.get(DRIVER_SESSION_COOKIE)?.maxAge).toBe(0);
    expect(result.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(driverSession(request('/api/auth/driver/session', {}, both)).status).toBe(401);
    expect(officeSession(request('/api/auth/session', {}, both)).status).toBe(200);
  });
});

it('blocks driver access to office routes in both the proxy and the handlers', async () => {
  const { cookie } = await login();
  const dashboard = proxy(new NextRequest(`${base}/`, { headers: { cookie } }));
  expect(dashboard.headers.get('location')).toBe(`${base}/login`);
  for (const pathname of ['/api/records', '/api/records?view=overview', '/api/export?type=daily', '/api/auth/session', '/api/records/id/photos/photo', '/blocked-call/other']) {
    const response = proxy(new NextRequest(`${base}${pathname}`, { headers: { cookie } }));
    expect([401, 303]).toContain(response.status);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  }
  expect((await getReports(request('/api/records', {}, cookie))).status).toBe(401);
  expect((await submitOfficeReport(request('/api/records', { method: 'POST', headers: { origin }, body: reportForm() }, cookie))).status).toBe(401);
  expect((await updateReport(request('/api/records', { method: 'PATCH', headers: { origin } }, cookie))).status).toBe(401);
  expect((await getExport(request('/api/export?type=daily', {}, cookie))).status).toBe(401);
  expect((await getPhoto(request('/api/records/id/photos/photo', {}, cookie), { params: Promise.resolve({ id: 'id', photoId: 'photo' }) })).status).toBe(401);
  expect(driverSession(request('/api/auth/driver/session', {}, `${DRIVER_SESSION_COOKIE}=${'x'.repeat(43)}`)).status).toBe(401);
  expect(driverSession(request('/api/auth/driver/session', {}, officeCookie())).status).toBe(401);
  expect((await submitDriverReport(request('/api/blocked-call', { method: 'POST', headers: { origin }, body: reportForm() }))).status).toBe(401);
});

it('validates locations, report type, photos and submission origin', async () => {
  const { cookie } = await login();
  for (const changes of [{ recordType: 'complaint' }, { category: 'Other' }, { siteAddress: 'Unlisted street' }]) {
    const result = await submitDriverReport(request('/api/blocked-call', { method: 'POST', headers: { origin }, body: reportForm(randomUUID(), changes) }, cookie));
    expect(result.status).toBe(400);
  }
  expect((await submitDriverReport(request('/api/blocked-call', { method: 'POST', headers: { origin }, body: reportForm(randomUUID(), {}, false) }, cookie))).status).toBe(400);
  expect((await submitDriverReport(request('/api/blocked-call', { method: 'POST', headers: { origin: 'https://untrusted.invalid' }, body: reportForm() }, cookie))).status).toBe(403);
});

it('saves driver reports and photos for office users, queues email, and returns only a receipt on retries', async () => {
  runtime.storage = createLocalStorage(directory);
  vi.stubEnv('REPORT_EMAIL_ENABLED', 'true');
  vi.stubEnv('REPORT_EMAIL_TO', 'office@example.invalid');
  const { cookie } = await login();
  const id = randomUUID();
  const submit = () => submitDriverReport(request('/api/blocked-call', { method: 'POST', headers: { origin }, body: reportForm(id) }, cookie));
  const response = await submit();
  expect(response.status).toBe(201);
  const result = await response.json() as { receipt: unknown; record?: unknown };
  expect(result.receipt).toEqual({ id, referenceNumber: expect.any(String), registeredCommunity: 'Test community', siteAddress: 'Test Street', photoCount: 1 });
  expect(result.record).toBeUndefined();
  const office = officeCookie();
  const listed = await (await getReports(request('/api/records', {}, office))).json() as { records: ReportRecord[] };
  expect(listed.records).toHaveLength(1);
  const record = listed.records[0];
  expect(record).toMatchObject({ id, employeeName: 'Driver', serviceType: 'Recycling' });
  const photo = await getPhoto(request(`/api/records/${id}/photos/${record.photos[0].id}`, {}, office), { params: Promise.resolve({ id, photoId: record.photos[0].id }) });
  expect(Buffer.from(await photo.arrayBuffer())).toEqual(photoBytes);
  const updated = await updateReport(request('/api/records', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ id, status: 'Resolved', resolutionDescription: 'Office-only details' }) }, office));
  expect(updated.status).toBe(200);
  expect(await (await submit()).json()).toEqual(result);
  // Names sent by an older client cannot change attribution or the retry identity.
  const suppliedName = await submitDriverReport(request('/api/blocked-call', {
    method: 'POST', headers: { origin }, body: reportForm(id, { employeeName: 'A supplied personal name' }),
  }, cookie));
  expect(suppliedName.status).toBe(201);
  expect(await suppliedName.json()).toEqual(result);
  const stored = await runtime.storage.database.prepare('SELECT employee_name FROM report_records WHERE id = ?').bind(id).first();
  expect(stored).toEqual({ employee_name: 'Driver' });
  const queued = await runtime.storage.database.prepare('SELECT recipient, sent_at FROM report_email_outbox WHERE report_id = ?').bind(id).first();
  expect(queued).toMatchObject({ recipient: 'office@example.invalid', sent_at: null });
});
