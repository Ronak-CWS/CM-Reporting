import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmailFixture, cloneEmailFixtureReport } from './helpers/email-fixture.mjs';
import { dailyBlockedCallWorkbook } from '../lib/blocked-call-workbook';
import { dailyBlockedCallAttachments } from '../lib/report-attachment.js';
import { privatePhotoPath } from '../lib/photo-path';

let fixture: Awaited<ReturnType<typeof createEmailFixture>> | undefined;
afterEach(async () => {
  if (fixture) { fixture.database.close(); await rm(fixture.directory, { recursive: true, force: true }); fixture = undefined; }
});

describe('compact blocked-call comparison reports', () => {
  it('fits 30 ordinary calls into at most 15 PDF pages and includes every photo in Excel', async () => {
    fixture = await createEmailFixture(await mkdtemp(path.join(tmpdir(), 'cm-report-volume-')));
    const ids = [fixture.id];
    for (let index = 1; index < 30; index++) ids.push(await cloneEmailFixtureReport(fixture));
    const [pdf] = await dailyBlockedCallAttachments(fixture.database, fixture.directory, ids, '2026-11-10');
    expect((await PDFDocument.load(pdf.content)).getPageCount()).toBeLessThanOrEqual(15);
    const [excel] = await dailyBlockedCallWorkbook(fixture.database, fixture.directory, ids, '2026-11-10');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel.content as unknown as ExcelJS.Buffer);
    const summary = workbook.getWorksheet('Summary')!;
    const details = workbook.getWorksheet('Details and photos')!;
    expect(summary.rowCount).toBe(34);
    expect(summary.autoFilter).toBe('A4:H34');
    expect(summary.getCell('B5').value).toBeInstanceOf(Date);
    expect(details.getImages()).toHaveLength(60);
    const references = new Set();
    for (let index = 5; index <= 34; index++) {
      const value = summary.getCell(`A${index}`).value as ExcelJS.CellHyperlinkValue;
      references.add(value.text);
      expect(details.getCell(value.hyperlink.split('!')[1]).value).toBe(value.text);
    }
    expect(references.size).toBe(30);
    expect(excel.content.length).toBeLessThan(5 * 1024 * 1024);
  }, 90000);

  it('preserves long notes, all six photos and original evidence; rejects an outside date or missing photo', async () => {
    fixture = await createEmailFixture(await mkdtemp(path.join(tmpdir(), 'cm-report-workbook-')), { photoCount: 6, longDescription: true });
    const { database, directory, id, keys, originals } = fixture;
    const [excel] = await dailyBlockedCallWorkbook(database, directory, [id], '2026-11-10');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel.content as unknown as ExcelJS.Buffer);
    const details = workbook.getWorksheet('Details and photos')!;
    expect(details.getImages()).toHaveLength(6);
    const texts: string[] = [];
    details.eachRow((row) => {
      expect(row.height).toBeLessThanOrEqual(409);
      texts.push(row.getCell(1).text);
    });
    expect(texts.join('\n')).toContain('END OF LONG DESCRIPTION');
    for (let index = 0; index < keys.length; index++) expect(await readFile(privatePhotoPath(directory, keys[index]))).toEqual(originals[index]);
    await expect(dailyBlockedCallWorkbook(database, directory, [id], '2026-11-09')).rejects.toMatchObject({ code: 'EATTACHMENT' });
    await rm(privatePhotoPath(directory, keys[0]));
    await expect(dailyBlockedCallWorkbook(database, directory, [id], '2026-11-10')).rejects.toMatchObject({ code: 'EATTACHMENT' });
  }, 30000);
});
