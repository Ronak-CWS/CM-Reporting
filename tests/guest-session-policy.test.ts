import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { microsoftConfig, SESSION_COOKIE, validateAuthenticationConfig } from '../lib/auth-config';
import { closeAuthStore, createSession, readSession } from '../lib/auth-store';
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
import { GET as getReports, POST as submitReport } from '../app/api/records/route';
import { GET as getExport } from '../app/api/export/route';
import { GET as getLocations } from '../app/api/locations/route';

const origin = 'https://cm.test';
let root: string;
let directory: string;
function request(route = '/', init: RequestInit = {}, cookie = '') {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  return new Request(`${origin}/cm-reporting${route}`, { ...init, headers });
}
const employee = { tenantId: '11111111-2222-3333-4444-555555555555', objectId: randomUUID(), name: 'Signed-in Driver', username: 'driver@example.invalid' };

beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'cm-guest-policy-')); });
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
beforeEach(() => {
  directory = path.join(root, randomUUID());
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CM_AUTH_MODE', 'microsoft');
  vi.stubEnv('CM_PUBLIC_ORIGIN', origin);
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_ENTRA_TENANT_ID', employee.tenantId);
  vi.stubEnv('CM_ENTRA_CLIENT_ID', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  vi.stubEnv('CM_ENTRA_CLIENT_SECRET', 'test-only-microsoft-secret-not-a-real-credential');
  vi.stubEnv('CM_ENTRA_REQUIRED_ROLE', '');
  vi.stubEnv('CM_DATA_DIR', directory);
  // Reuse the server's original guest environment settings without rotating its password.
  vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'true');
  vi.stubEnv('CM_GUEST_LOGIN_PASSWORD', 'test-only-previous-guest-password');
  vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', new Date(Date.now() + 86400_000).toISOString());
});
afterEach(() => {
  closeAuthStore();
  runtime.storage?.close();
  runtime.storage = undefined;
  vi.unstubAllEnvs();
});

it('restores login with the existing password and guest environment settings', async () => {
  expect(() => validateAuthenticationConfig()).not.toThrow();
  const response = await guestLogin(request('/api/auth/guest', {
    method: 'POST', headers: { origin }, body: new URLSearchParams({ password: process.env.CM_GUEST_LOGIN_PASSWORD! }),
  }));
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/cm-reporting/');
  const token = response.cookies.get(SESSION_COOKIE)!.value;
  expect(signedInUser(request('/', {}, `${SESSION_COOKIE}=${token}`))).toEqual({
    kind: 'guest', name: 'Guest user', username: 'Temporary guest access',
  });
});

it.each(['guest:legacy-policy', 'current'])('rejects legacy or Microsoft-policy guest identities with policy %s', async (policy) => {
  const settings = microsoftConfig();
  const memberToken = createSession(employee, settings.policy);
  const guestToken = createSession(employee, settings.policy);
  const db = new DatabaseSync(path.join(directory, 'auth.sqlite'));
  try {
    db.prepare('UPDATE sessions SET user_json = ?, policy = ? WHERE token_hash = ?').run(
      JSON.stringify({ kind: 'guest', name: 'Guest tester', username: 'Temporary test access' }),
      policy === 'current' ? settings.policy : policy, createHash('sha256').update(guestToken).digest('hex'),
    );
  } finally { db.close(); }
  const cookie = `${SESSION_COOKIE}=${guestToken}`;
  expect(signedInUser(request('/', {}, cookie))).toBeNull();
  expect(accessFailure(request('/', {}, cookie))?.status).toBe(401);
  expect((await getReports(request('/api/records', {}, cookie))).status).toBe(401);
  expect((await submitReport(request('/api/records', { method: 'POST', headers: { origin } }, cookie))).status).toBe(401);
  expect((await getExport(request('/api/export', {}, cookie))).status).toBe(401);
  expect((await getLocations(request('/api/locations', {}, cookie))).status).toBe(401);
  expect(readSession(memberToken, settings.policy)?.name).toBe(employee.name);
});

it('keeps Microsoft report attribution and the shared company register', async () => {
  runtime.storage = createLocalStorage(directory);
  const cookie = `${SESSION_COOKIE}=${createSession(employee, microsoftConfig().policy)}`;
  const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.set('report', JSON.stringify({ recordType: 'daily', category: 'Blocked call', scope: 'street', reasonCode: 'flooding', registeredCommunity: 'Test community', siteAddress: 'Test Street', employeeName: 'Someone else', serviceType: 'Waste' }));
  form.set('submissionId', randomUUID());
  form.append('photos', new File([photo], 'blockage.png', { type: 'image/png' }));
  const response = await submitReport(request('/api/records', { method: 'POST', headers: { origin }, body: form }, cookie));
  expect(response.status).toBe(201);
  const { record } = await response.json() as { record: ReportRecord };
  expect(record.employeeName).toBe('Signed-in Driver');
  expect(record.serviceType).toBe('Recycling');
  const colleague = `${SESSION_COOKIE}=${createSession({ ...employee, objectId: randomUUID(), name: 'Colleague' }, microsoftConfig().policy)}`;
  const listed = await (await getReports(request('/api/records', {}, colleague))).json() as { records: ReportRecord[] };
  expect(listed.records.find((item) => item.id === record.id)?.employeeName).toBe('Signed-in Driver');
});
