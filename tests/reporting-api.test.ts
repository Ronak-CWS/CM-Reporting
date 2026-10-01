import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupStorage, verifyBackup } from '../scripts/storage-maintenance.mjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalStorage, type PhotoStorage, type StorageDatabase } from '../lib/local-storage';
import type { ReportRecord } from '../lib/report-types';

const { runtime } = vi.hoisted(() => ({ runtime: { storage: undefined as ReturnType<typeof createLocalStorage> | undefined, photos: undefined as PhotoStorage | undefined } }));
vi.mock('../lib/local-storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/local-storage')>(),
  getDatabase: () => runtime.storage!.database,
  getPhotoStorage: () => runtime.photos || runtime.storage!.photos,
}));
vi.mock('../lib/location-catalogue-store', async () => {
  const { createLocationCatalogue } = await import('../lib/location-catalogue');
  const catalogue = createLocationCatalogue((await import('./fixtures/service-locations.json')).default);
  return { getLocationCatalogue: () => catalogue };
});

import { GET, POST, PATCH } from '../app/api/records/route';
import { GET as getPhoto } from '../app/api/records/[id]/photos/[photoId]/route';
import { GET as exportRecords } from '../app/api/export/route';

const photoBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64'));
const baseReport = {
  recordType: 'daily', category: 'Blocked call', scope: 'street', reasonCode: 'flooding',
  registeredCommunity: 'Test community', siteAddress: 'Test Street', employeeName: 'Test Driver',
  streetFrom: 'First Avenue', streetTo: 'Third Avenue',
};
let directory: string;
let testRoot: string;
let database: StorageDatabase;

async function photoFiles(id: string) {
  try { return await readdir(path.join(directory, 'photos', 'reports', id)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

function submission(id = crypto.randomUUID(), patch = {}, includePhoto = true, count = 1) {
  const form = new FormData();
  form.set('report', JSON.stringify({ ...baseReport, ...patch }));
  form.set('submissionId', id);
  if (includePhoto) for (let index = 0; index < count; index++) form.append('photos', new File([photoBytes], `blocked-${index}.png`, { type: 'image/png' }));
  return new Request('https://cm.test/api/records', { method: 'POST', body: form });
}

beforeAll(async () => {
  testRoot = await mkdtemp(path.join(tmpdir(), 'cm-reporting-api-test-'));
  directory = path.join(testRoot, 'live');
  runtime.storage = createLocalStorage(directory);
  database = runtime.storage.database;
  // Apply the actual committed migration sequence to a fresh test database.
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').filter((part) => part.trim())) {
      await database.prepare(statement).run();
    }
  }
}, 30000);
afterAll(async () => { runtime.storage?.close(); if (testRoot) await rm(testRoot, { recursive: true, force: true }); });

describe('durable blocked call reports', () => {
  it('saves the street report, reloads evidence, and serves/downloads the original image', async () => {
    const response = await POST(submission());
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    expect(record.blockage).toMatchObject({ scope: 'street', reasonLabel: 'Flooded street', streetFrom: 'First Avenue' });
    expect(record.photos).toHaveLength(1);
    // Reopen the on-disk database and folder, as after an application restart.
    runtime.storage!.close();
    runtime.storage = createLocalStorage(directory);
    database = runtime.storage.database;
    const list = await (await GET(new Request('https://cm.test/api/records'))).json() as { records: ReportRecord[] };
    expect(list.records.find((item) => item.id === record.id)?.photos).toEqual(record.photos);
    const photo = record.photos[0];
    const context = { params: Promise.resolve({ id: record.id, photoId: photo.id }) };
    const image = await getPhoto(new Request(`https://cm.test${photo.url}`), context);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('Cache-Control')).toBe('private, no-store');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(photoBytes);
    const download = await getPhoto(new Request(`https://cm.test${photo.url}?download=1`), context);
    expect(download.headers.get('Content-Disposition')).toContain('attachment;');
    const mismatch = await getPhoto(new Request(`https://cm.test${photo.url}`), { params: Promise.resolve({ id: 'another-record', photoId: photo.id }) });
    expect(mismatch.status).toBe(404);

    const updated = await PATCH(new Request('https://cm.test/api/records', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: record.id, status: 'Resolved', resolutionDescription: 'Road reopened' }),
    }));
    const result = await updated.json() as { record: ReportRecord };
    expect(result.record.status).toBe('Resolved');
    expect(result.record.photos).toEqual(record.photos);
    const csv = await (await exportRecords(new Request('https://cm.test/api/export?type=daily'))).text();
    expect(csv).toContain('"Photo Count"');
    expect(csv).toContain('"Street block","Flooded street","First Avenue","Third Avenue","","1","blocked-0.png"');
    expect(csv).toContain(photo.url);
  });

  it('saves a retry only once and rejects a changed report using the same ID', async () => {
    const id = crypto.randomUUID();
    const first = await POST(submission(id));
    const retry = await POST(submission(id));
    const a = await first.json() as { record: ReportRecord };
    const b = await retry.json() as { record: ReportRecord };
    expect(a.record).toEqual(b.record);
    expect(await photoFiles(id)).toHaveLength(1);
    expect((await POST(submission(id, { siteAddress: 'Test Avenue' }))).status).toBe(409);
  });

  it('requires photos for both scopes and rejects other submission types and invalid reasons', async () => {
    const id = crypto.randomUUID();
    expect((await POST(submission(id, {}, false))).status).toBe(400);
    expect((await POST(submission(id, { scope: 'pickup', reasonCode: 'blocked_by_car' }, false))).status).toBe(400);
    expect((await POST(submission(id, { category: 'Incident' }))).status).toBe(400);
    expect((await POST(submission(id, { reasonCode: 'blocked_by_car' }))).status).toBe(400);
    expect(await database.prepare('SELECT id FROM report_records WHERE id = ?').bind(id).first()).toBeNull();
  });

  it('does not leave a partial record or earlier photos if an upload fails', async () => {
    const id = crypto.randomUUID();
    let uploads = 0;
    const photos = runtime.storage!.photos;
    runtime.photos = {
      ...photos,
      put: async (...args: Parameters<PhotoStorage['put']>) => {
        if (++uploads === 2) throw new Error('Test upload interruption');
        return photos.put(...args);
      },
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await POST(submission(id, {}, true, 2))).status).toBe(500);
      expect(await database.prepare('SELECT id FROM report_records WHERE id = ?').bind(id).first()).toBeNull();
      expect(await photoFiles(id)).toHaveLength(0);
    } finally { runtime.photos = undefined; errorLog.mockRestore(); }
    expect((await POST(submission(id, {}, true, 2))).status).toBe(201);
  });

  it('rejects unlisted locations and incomplete plates before storing any photos', async () => {
    for (const patch of [
      { registeredCommunity: 'Unlisted community' },
      { siteAddress: 'Unlisted street' },
      { scope: 'pickup', siteAddress: '123 Test Street', reasonCode: 'blocked_by_vehicle' },
      { scope: 'pickup', siteAddress: '123 Test Street', reasonCode: 'blocked_by_multiple_vehicles', vehiclePlates: ['ABC123'] },
      { reasonCode: 'other', otherReason: '  ' },
    ]) {
      const id = crypto.randomUUID();
      expect((await POST(submission(id, patch))).status).toBe(400);
      expect(await database.prepare('SELECT id FROM report_records WHERE id = ?').bind(id).first()).toBeNull();
      expect(await photoFiles(id)).toHaveLength(0);
    }
  });

  it('reloads and exports all vehicle plates', async () => {
    const response = await POST(submission(crypto.randomUUID(), { scope: 'pickup', siteAddress: '123 Test Street', reasonCode: 'blocked_by_multiple_vehicles', vehiclePlates: ['ABC123', 'XYZ789', 'THIRD1'] }));
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    const list = await (await GET(new Request('https://cm.test/api/records'))).json() as { records: ReportRecord[] };
    expect(list.records.find((item) => item.id === record.id)?.blockage?.vehiclePlates).toBe('ABC123, XYZ789, THIRD1');
    expect(await (await exportRecords(new Request('https://cm.test/api/export?type=daily'))).text()).toContain('"ABC123, XYZ789, THIRD1"');
  });

  it('continues to save and export the original Exhibit 7 complaint fields', async () => {
    const response = await POST(new Request('https://cm.test/api/records', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordType: 'complaint', occurredAt: '2026-09-17T10:00', registeredCommunity: 'Test community',
        category: 'Missed collection', employeeName: 'Test Staff', employeeTitle: 'Dispatcher', contactMedium: 'Phone call',
        customerName: 'Test Customer', customerAddress: '456 Example Avenue', customerContactInformation: 'customer@example.invalid',
        issueDescription: 'Test complaint', status: 'Open', priority: 'Normal' }),
    }));
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    expect(record.blockage).toBeNull();
    expect(record.photos).toEqual([]);
    const csv = await (await exportRecords(new Request('https://cm.test/api/export?type=complaints'))).text();
    expect(csv.split('\r\n')[0].split('","')).toHaveLength(12);
    expect(csv).toContain('"Test Staff","Dispatcher","Test Customer","456 Example Avenue","customer@example.invalid","Test complaint"');
  });

  it('backs up a live SQLite database with every referenced original photo and verifies restoration', async () => {
    const destination = path.join(testRoot, 'backup');
    const catalogue = fileURLToPath(new URL('./fixtures/service-locations.json', import.meta.url));
    const manifest = await backupStorage(directory, destination, catalogue);
    expect(manifest.reports).toBeGreaterThan(0);
    expect(manifest.photos).toBeGreaterThan(0);
    expect(await verifyBackup(destination)).toEqual({ reports: manifest.reports, photos: manifest.photos });
    await expect(backupStorage(directory, destination, catalogue)).rejects.toThrow();
    const live = runtime.storage!;
    const restored = createLocalStorage(destination);
    try {
      runtime.storage = restored;
      const { records } = await (await GET(new Request('https://cm.test/api/records'))).json() as { records: ReportRecord[] };
      expect(records).toHaveLength(manifest.reports);
      for (const record of records) for (const photo of record.photos) {
        const response = await getPhoto(new Request(`https://cm.test${photo.url}`), { params: Promise.resolve({ id: record.id, photoId: photo.id }) });
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(photoBytes);
      }
    } finally { runtime.storage = live; restored.close(); }
  });
});
