import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalStorage } from '../lib/local-storage';
import { edmontonDateKey } from '../lib/report-time';
import type { ReportPage, ReportingOverview } from '../lib/report-filters';
import { reportingWeekStart, type ReportWeeks } from '../lib/report-weeks';
import ExcelJS from 'exceljs';

const { runtime } = vi.hoisted(() => ({ runtime: { storage: undefined as ReturnType<typeof createLocalStorage> | undefined } }));
vi.mock('../lib/local-storage', async (original) => ({
  ...await original<typeof import('../lib/local-storage')>(),
  getDatabase: () => runtime.storage!.database,
  getPhotoStorage: () => runtime.storage!.photos,
}));
import { GET } from '../app/api/records/route';
import { GET as exportRecords } from '../app/api/export/route';
const get = (query = '') => GET(new Request(`https://cm.test/api/records?${query}`));
const page = async (query = '') => (await (await get(query)).json()) as ReportPage;
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cm-record-query-'));
  runtime.storage = createLocalStorage(directory);
  await get(); // Initialize the production schema, including upgrade indexes.
  const db = runtime.storage.sqlite;
  const insert = db.prepare(`INSERT INTO report_records
    (id, reference_number, record_type, occurred_at, reported_at, registered_community, category, employee_name,
     customer_name, customer_address, issue_description, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (let i = 0; i < 1105; i++) {
      const id = String(i).padStart(5, '0');
      const date = i === 0 ? '2024-02-29T23:55:00-07:00' : `${edmontonDateKey()}T08:00:00-06:00`;
      insert.run(id, `CM-CMP-TEST-${id}`, i === 1104 ? 'daily' : 'complaint', date, date,
        'Test community', 'Service quality', 'Test staff', '', i === 0 ? '99 Old Avenue' : `${i} New Street`,
        i === 0 ? 'An older report with 100% recycling' : 'Missed collection',
        i % 2 ? 'Resolved' : 'Open', i % 3 ? 'Normal' : 'High', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
afterAll(async () => { runtime.storage?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('register pages', () => {
  it('counts all matching reports by week, independently of record pagination', async () => {
    const result = await (await get('type=complaint&groupBy=week')).json() as ReportWeeks;
    expect(result).toEqual({ total: 1104, weeks: [{ start: reportingWeekStart(), total: 1103 }, { start: '2024-02-26', total: 1 }] });
    const filtered = await (await get('type=complaint&groupBy=week&status=Open&priority=High&q=Old&dateMode=day&from=2024-02-29&to=2024-02-29')).json();
    expect(filtered).toEqual({ total: 1, weeks: [{ start: '2024-02-26', total: 1 }] });
    expect(await (await get('type=daily&groupBy=week')).json()).toEqual({ total: 1, weeks: [{ start: reportingWeekStart(), total: 1 }] });
  });

  it.each([
    ['2024-03-03T23:55:00-07:00', '2024-02-26'],
    ['2024-03-04T00:01:00-07:00', '2024-03-04'],
    ['2024-03-10T23:55:00-06:00', '2024-03-04'],
  ])('uses the Mountain calendar week for %s', async (timestamp, start) => {
    const db = runtime.storage!.sqlite;
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE report_records SET occurred_at = ? WHERE id = '00000'").run(timestamp);
      expect(await (await get('groupBy=week&q=99%20Old%20Avenue')).json()).toEqual({ total: 1, weeks: [{ start, total: 1 }] });
    } finally { db.exec('ROLLBACK'); }
  });

  it('returns 50 newest records and uses stable cursors for ties, including beyond the old 1000-row cap', async () => {
    const first = await page('type=complaint');
    expect(first.records).toHaveLength(50);
    expect(first.total).toBe(1104);
    expect(first.records[0].id).toBe('01103');
    const ids = first.records.map((record) => record.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await page(`type=complaint&cursor=${cursor}`);
      expect(next.records.length).toBeLessThanOrEqual(50);
      ids.push(...next.records.map((record) => record.id));
      cursor = next.nextCursor;
    }
    expect(ids).toHaveLength(1104);
    expect(new Set(ids).size).toBe(1104);
    expect(ids.at(-1)).toBe('00000');
  });
  it('searches reference numbers, addresses, and older records across the whole database', async () => {
    for (const q of ['99 Old Avenue', 'CM-CMP-TEST-00000', '100% recycling']) {
      const result = await page(`type=complaint&q=${encodeURIComponent(q)}`);
      expect(result.records.map((record) => record.id)).toEqual(['00000']);
      expect(result.total).toBe(1);
      expect(result.nextCursor).toBeNull();
    }
    expect((await page('q=Missed')).records).toHaveLength(50);
    expect((await page('q=Missed')).total).toBe(1104);
    expect((await page('q=%27%20OR%201%3D1--')).total).toBe(0);
  });
  it('combines status, priority, type, and inclusive Mountain-date filters', async () => {
    const result = await page('type=complaint&status=Open&priority=High&dateMode=day&from=2024-02-29&to=2024-02-29');
    expect(result.total).toBe(1);
    expect(result.records[0].id).toBe('00000');
    expect((await page('dateMode=range&from=2024-02-28&to=2024-03-01')).total).toBe(1);
    const today = await page(`dateMode=day&from=${edmontonDateKey()}`);
    expect(today.total).toBe(1104);
  });
  it.each([
    'dateMode=range&from=2024-02-29&to=2024-02-29',
    'dateMode=range&from=2024-03-01&to=2024-02-29',
    'dateMode=range&from=2024-03-01', 'dateMode=day&from=2099-01-01',
    'dateMode=day&from=2026-02-29', 'dateMode=day&from=2024-02-29&to=2024-03-01',
    'status=Unknown', 'priority=Unknown', 'type=Unknown', 'cursor=invalid', 'status=Open&status=Resolved',
    'groupBy=day', 'groupBy=week&groupBy=week', 'groupBy=week&cursor=invalid',
  ])('rejects invalid filters or cursors: %s', async (query) => { expect((await get(query)).status).toBe(400); });
  it('rejects a cursor reused with different filters', async () => {
    const first = await page('type=complaint');
    expect((await get(`type=complaint&priority=High&cursor=${first.nextCursor}`)).status).toBe(400);
  });
  it('returns exact dashboard counts independently of the five recent records', async () => {
    const response = await get('view=overview');
    expect(response.status).toBe(200);
    const result = await response.json() as { overview: ReportingOverview; records: unknown[] };
    expect(result.records).toHaveLength(5);
    expect(result.overview).toMatchObject({ todayRecords: 1104, todayCommunities: 1, todayComplaints: 1103, openActions: 553, flaggedActions: 185 });
  });
  it('exports all matches, including records beyond the first 1000', async () => {
    const response = await exportRecords(new Request('https://cm.test/api/export?type=complaints&format=csv'));
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.split('\r\n')).toHaveLength(1105);
    expect(csv).toContain('CM-CMP-TEST-00000');
    const filtered = await exportRecords(new Request('https://cm.test/api/export?type=complaints&q=99%20Old%20Avenue'));
    expect((await filtered.text()).split('\r\n')).toHaveLength(2);
  });
  it('downloads a complete Excel workbook through the authenticated export handler', async () => {
    const response = await exportRecords(new Request('https://cm.test/api/export?type=complaints&format=xlsx'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('Content-Disposition')).toMatch(/CM_Exhibit_7_Complaints_.*\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(1109);
    expect(sheet.getCell('A5').value).toBe('Reference number');
    expect(sheet.getCell('A1109').value).toBe('CM-CMP-TEST-00000');
    expect(sheet.getCell('H1109').value).toBe('99 Old Avenue');
  });
});
