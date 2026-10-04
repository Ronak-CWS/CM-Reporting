import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { GET, POST, PATCH } from '../app/api/records/route';
import { GET as exportRecords } from '../app/api/export/route';

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
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cm-complaint-test-'));
  runtime.storage = createLocalStorage(directory);
  // Start from the original schema, with a real pre-upgrade complaint in it.
  runtime.storage.sqlite.exec(await readFile(new URL('../drizzle/0000_tricky_whizzer.sql', import.meta.url), 'utf8'));
  runtime.storage.sqlite.prepare(`INSERT INTO report_records
    (id, reference_number, record_type, occurred_at, reported_at, registered_community, category,
     employee_name, issue_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('legacy-complaint', 'CM-CMP-LEGACY', 'complaint', complaint.occurredAt, complaint.occurredAt,
      complaint.registeredCommunity, 'Other', complaint.employeeName, 'Existing complaint details', complaint.occurredAt, complaint.occurredAt);
});
beforeEach(() => { runtime.catalogueAvailable = true; });
afterAll(async () => {
  runtime.storage?.close();
  vi.unstubAllEnvs();
  // Remove only the exact temporary directory created by this suite.
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('complaint Other explanations', () => {
  it.each([undefined, '', '   ', 123])('requires a written explanation for Other (%s)', async (categoryOtherReason) => {
    const response = await submit({ category: 'Other', categoryOtherReason });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Explain the reason for choosing Other.' });
  });
  it('rejects an oversized explanation and an unlisted category', async () => {
    expect((await submit({ category: 'Other', categoryOtherReason: 'x'.repeat(501) })).status).toBe(400);
    expect((await submit({ category: 'other', categoryOtherReason: 'Example' })).status).toBe(400);
  });
  it('discards a stale Other explanation when a listed category is selected', async () => {
    const response = await submit({ categoryOtherReason: 'No longer applicable' });
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    expect(record.categoryOtherReason).toBe('');
  });
  it('preserves old complaints when the additional storage is created automatically', async () => {
    const { records } = await (await GET(new Request('https://cm.test/api/records'))).json() as { records: ReportRecord[] };
    expect(records.find(record => record.id === 'legacy-complaint')).toMatchObject({
      category: 'Other', categoryOtherReason: '', issueDescription: 'Existing complaint details',
    });
  });
  it('saves the explanation through restart and resolution updates and includes it in exports and queued mail', async () => {
    vi.stubEnv('REPORT_EMAIL_ENABLED', 'true');
    vi.stubEnv('REPORT_EMAIL_TO', 'office@example.invalid');
    vi.stubEnv('CM_PUBLIC_ORIGIN', 'https://cm.test');
    const reason = 'Request for a community information session';
    const response = await submit({ category: 'Other', categoryOtherReason: `  ${reason}  ` });
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    expect(record.categoryOtherReason).toBe(reason);
    runtime.storage!.close();
    runtime.storage = createLocalStorage(directory);
    const { records } = await (await GET(new Request('https://cm.test/api/records'))).json() as { records: ReportRecord[] };
    expect(records.find(item => item.id === record.id)?.categoryOtherReason).toBe(reason);
    const updated = await PATCH(new Request('https://cm.test/api/records', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: record.id, status: 'Resolved', resolutionDescription: 'Information provided.' }),
    }));
    expect(updated.status).toBe(200);
    expect((await updated.json() as { record: ReportRecord }).record.categoryOtherReason).toBe(reason);
    for (const type of ['complaints', 'daily']) {
      const csv = await (await exportRecords(new Request(`https://cm.test/api/export?type=${type}`))).text();
      expect(csv).toContain(`Other category reason: ${reason}\n\n${complaint.issueDescription}`);
      if (type === 'complaints') expect(csv.split('\r\n')[0].split('\",\"')).toHaveLength(12);
    }
    expect(await runtime.storage.database.prepare('SELECT body FROM report_email_outbox WHERE report_id = ?').bind(record.id).first())
      .toHaveProperty('body', expect.stringContaining(`Other category reason: ${reason}`));
  });
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
