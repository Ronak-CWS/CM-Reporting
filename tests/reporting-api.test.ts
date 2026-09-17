import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { ReportRecord } from '../lib/report-types';

const { runtime } = vi.hoisted(() => ({ runtime: { env: {} as Record<string, unknown> } }));
vi.mock('cloudflare:workers', () => ({ env: runtime.env }));

import { GET, POST, PATCH } from '../app/api/records/route';
import { GET as getPhoto } from '../app/api/records/[id]/photos/[photoId]/route';
import { GET as exportRecords } from '../app/api/export/route';

const photoBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64'));
const baseReport = {
  recordType: 'daily', category: 'Blocked call', scope: 'street', reasonCode: 'flooding',
  registeredCommunity: 'Test community', siteAddress: 'Test Street', employeeName: 'Test Driver',
  streetFrom: 'First Avenue', streetTo: 'Third Avenue',
};
let miniflare: Miniflare;
let database: D1Database;
let bucket: R2Bucket;

function submission(id = crypto.randomUUID(), patch = {}, includePhoto = true, count = 1) {
  const form = new FormData();
  form.set('report', JSON.stringify({ ...baseReport, ...patch }));
  form.set('submissionId', id);
  if (includePhoto) for (let index = 0; index < count; index++) form.append('photos', new File([photoBytes], `blocked-${index}.png`, { type: 'image/png' }));
  return new Request('https://cm.test/api/records', { method: 'POST', body: form });
}

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("isolated test runtime") } }',
    compatibilityDate: '2026-05-15',
    d1Databases: ['DB'], r2Buckets: ['PHOTOS'],
  });
  database = await miniflare.getD1Database('DB') as unknown as D1Database;
  bucket = await miniflare.getR2Bucket('PHOTOS') as unknown as R2Bucket;
  runtime.env.DB = database;
  runtime.env.PHOTOS = bucket;
  // Apply the actual committed migration sequence to a fresh test database.
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').filter((part) => part.trim())) {
      await database.prepare(statement).run();
    }
  }
}, 30000);
afterAll(async () => { await miniflare?.dispose(); });

describe('durable blocked call reports', () => {
  it('saves the street report, reloads evidence, and serves/downloads the original image', async () => {
    const response = await POST(submission());
    expect(response.status).toBe(201);
    const { record } = await response.json() as { record: ReportRecord };
    expect(record.blockage).toMatchObject({ scope: 'street', reasonLabel: 'Flooded street', streetFrom: 'First Avenue' });
    expect(record.photos).toHaveLength(1);
    const list = await (await GET()).json() as { records: ReportRecord[] };
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
    expect((await bucket.list({ prefix: `reports/${id}/` })).objects).toHaveLength(1);
    expect((await POST(submission(id, { siteAddress: 'A changed address' }))).status).toBe(409);
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
    runtime.env.PHOTOS = {
      put: async (...args: Parameters<R2Bucket['put']>) => {
        if (++uploads === 2) throw new Error('Test upload interruption');
        return bucket.put(...args);
      },
      delete: (keys: string[]) => bucket.delete(keys),
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await POST(submission(id, {}, true, 2))).status).toBe(500);
      expect(await database.prepare('SELECT id FROM report_records WHERE id = ?').bind(id).first()).toBeNull();
      expect((await bucket.list({ prefix: `reports/${id}/` })).objects).toHaveLength(0);
    } finally { runtime.env.PHOTOS = bucket; errorLog.mockRestore(); }
    expect((await POST(submission(id, {}, true, 2))).status).toBe(201);
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
});
