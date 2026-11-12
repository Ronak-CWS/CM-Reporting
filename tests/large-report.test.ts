import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmailFixture, cloneEmailFixtureReport } from './helpers/email-fixture.mjs';
import { dailyBlockedCallAttachments } from '../lib/report-attachment.js';
import { dailyBlockedCallWorkbook } from '../lib/blocked-call-workbook';
import { privatePhotoPath } from '../lib/photo-path';

let fixture: Awaited<ReturnType<typeof createEmailFixture>> | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (!fixture) return;
  fixture.database.close();
  const relative = path.relative(tmpdir(), fixture.directory);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(fixture.directory).startsWith('cm-large-report-')) throw new Error('Unexpected fixture path.');
  await rm(fixture.directory, { recursive: true, force: true });
  fixture = undefined;
});

it('exports all 234 high-detail photos in PDF and Excel above the old 5 MiB cap', async () => {
  vi.stubEnv('REPORT_ATTACHMENT_MAX_MB', '20');
  fixture = await createEmailFixture(await mkdtemp(path.join(tmpdir(), 'cm-large-report-')), { photoCount: 1 });
  const { database, directory, id, keys } = fixture;
  const raw = Buffer.alloc(1024 * 768 * 3);
  let state = 123456789;
  for (let index = 0; index < raw.length; index++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    raw[index] = state & 255;
  }
  const original = await sharp(raw, { raw: { width: 1024, height: 768, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  await writeFile(privatePhotoPath(directory, keys[0]), original);
  database.prepare("UPDATE report_photos SET content_type = 'image/jpeg', file_name = 'detailed-photo.jpg', size = ?").run(original.length);
  const ids = [id];
  for (let index = 1; index < 234; index++) ids.push(await cloneEmailFixtureReport(fixture));
  const [pdf] = await dailyBlockedCallAttachments(database, directory, ids, '2026-11-10');
  expect(pdf.content.length).toBeGreaterThan(5 * 1024 * 1024);
  expect(pdf.content.length).toBeLessThanOrEqual(20 * 1024 * 1024);
  const document = await PDFDocument.load(pdf.content);
  let images = 0;
  for (const page of document.getPages()) {
    const objects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    if (objects) for (const [, ref] of objects.entries()) {
      const object = document.context.lookup(ref);
      if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
        images++;
        expect(Number(object.dict.get(PDFName.of('Width'))?.toString())).toBeGreaterThanOrEqual(512);
      }
    }
  }
  expect(images).toBe(234);
  const [excel] = await dailyBlockedCallWorkbook(database, directory, ids, '2026-11-10');
  expect(excel.content.length).toBeGreaterThan(5 * 1024 * 1024);
  expect(excel.content.length).toBeLessThanOrEqual(20 * 1024 * 1024);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel.content as unknown as ExcelJS.Buffer);
  expect(workbook.getWorksheet('Summary')?.rowCount).toBe(238);
  expect(workbook.getWorksheet('Details and photos')?.getImages()).toHaveLength(234);
  expect(await readFile(privatePhotoPath(directory, keys[0]))).toEqual(original);
}, 120000);
