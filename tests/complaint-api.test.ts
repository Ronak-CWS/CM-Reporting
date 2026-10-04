import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorage } from '../lib/local-storage';
import type { ReportRecord } from '../lib/report-types';

const { runtime } = vi.hoisted(() => ({ runtime: {
  storage: undefined as ReturnType<typeof createLocalStorage> | undefined, catalogueAvailable: true,
} }));
vi.mock('../lib/local-storage', async (original) => ({
  ...await original<typeof import('../lib/local-storage')>(),
  getDatabase: () => runtime.storage!.database,
  getPhotoStorage: () => runtime.storage!.photos,
}));
vi.mock('../lib/location-catalogue-store', async () => {
  const { createLocationCatalogue } = await import('../lib/location-catalogue');
  const locations = (await import('./fixtures/service-locations.json')).default;
  return { getLocationCatalogue: () => createLocationCatalogue(runtime.catalogueAvailable ? locations : []) };
});
import { GET, POST } from '../app/api/records/route';

const complaint = {
  recordType: 'complaint', occurredAt: '2026-10-04T14:00', registeredCommunity: 'Test community',
  category: 'Service quality', employeeName: 'Test Staff', employeeTitle: 'Dispatcher', contactMedium: 'Phone call',
  customerName: 'Test Customer', customerAddress: '456 Example Avenue', customerContactInformation: 'customer@example.invalid',
  issueDescription: 'Details of the service complaint.', status: 'Open', priority: 'Normal',
};
function submit(patch: Record<string, unknown> = {}) {
  return POST(new Request('https://cm.test/api/records', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...complaint, ...patch }),
  }));
}
let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'cm-complaint-test-')); runtime.storage = createLocalStorage(directory); });
beforeEach(() => { runtime.catalogueAvailable = true; });
afterAll(async () => {
  runtime.storage?.close();
  // Remove only the exact temporary directory created by this suite.
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('complaint communities', () => {
  it.each(['Tes', 'Made-up community'])('rejects unlisted community %s on direct API submission', async (registeredCommunity) => {
    const response = await submit({ registeredCommunity });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Choose a registered community from the service list.' });
  });
  it('saves and reloads the catalogue spelling without requiring a pickup address', async () => {
    const response = await submit({ registeredCommunity: '  test COMMUNITY  ' });
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    expect(record.registeredCommunity).toBe('Test community');
    const listed = await (await GET(new Request('https://cm.test/api/records'))).json() as { records: ReportRecord[] };
    expect(listed.records.find(item => item.id === record.id)?.registeredCommunity).toBe('Test community');
  });
  it('fails closed if the community catalogue is unavailable', async () => {
    runtime.catalogueAvailable = false;
    const response = await submit();
    expect(response.status).toBe(503);
    expect((await response.json() as { error: string }).error).toContain('community list is not available');
  });
});
