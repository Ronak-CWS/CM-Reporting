import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import decodeHeic from 'heic-decode';
import { privatePhotoPath } from './photo-path.ts';
import { blockedCallReport, dailyBlockedCallReports, blockedCallDetailRows, cleanReportText } from './blocked-call-report.js';

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 600 * 1024;
const INK = rgb(0.12, 0.19, 0.22);
const GREEN = rgb(0.04, 0.35, 0.28);
const MUTED = rgb(0.38, 0.43, 0.46);
let fontBytes;

function attachmentError(cause) {
  return Object.assign(new Error('The report PDF could not be prepared with all of its photos.', { cause }), { code: 'EATTACHMENT' });
}

// Decode only the first frame of animated images; never modify stored evidence.
export async function emailPhoto(bytes, contentType, maxBytes = MAX_IMAGE_BYTES) {
  let source = bytes;
  const options = { limitInputPixels: 100000000, animated: false };
  if (['image/heic', 'image/heif'].includes(contentType)) {
    const images = await decodeHeic.all({ buffer: bytes });
    try {
      const first = images[0];
      if (!first || first.width * first.height > options.limitInputPixels) throw attachmentError(new Error('HEIC photo has no usable frame or exceeds 100 million pixels.'));
      const decoded = await first.decode();
      source = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
      options.raw = { width: decoded.width, height: decoded.height, channels: 4 };
    } finally { images.dispose(); }
  }
  for (const [size, quality] of [[1600, 80], [1280, 72], [1024, 60], [800, 50], [640, 45]]) {
    const result = await sharp(source, options)
      .rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (result.length <= maxBytes) return result;
  }
  throw attachmentError(new Error(`The resized photo exceeds the ${maxBytes}-byte image budget.`));
}

/** Resized copies only: the saved evidence files are never changed. */
export async function reportPhotoCopies(entry, directory, maxBytes = MAX_IMAGE_BYTES) {
  const result = [];
  for (const photo of entry.photos) {
    const original = await readFile(privatePhotoPath(directory, photo.storage_key));
    if (!original.length || original.length > 10 * 1024 * 1024) throw attachmentError(new Error('Saved photo is empty or exceeds the 10 MiB upload limit.'));
    const content = await emailPhoto(original, photo.content_type, maxBytes);
    const { width, height } = await sharp(content).metadata();
    result.push({ ...photo, content, width, height });
  }
  return result;
}

export function reportImageBudget(entries) {
  const photoCount = entries.reduce((count, entry) => count + entry.photos.length, 0);
  // One shared font and a modest allowance for text/structure, then all images.
  const budget = Math.min(MAX_IMAGE_BYTES, Math.floor((MAX_PDF_BYTES - 131072 - entries.length * 4096) / Math.max(1, photoCount)));
  if (budget <= 0) throw attachmentError(new Error('The daily report has no remaining photo budget within the 5 MiB attachment limit.'));
  return budget;
}

async function compactBlockedCallPdf(entries, directory, title, context, budget) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  fontBytes ||= readFile(path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.woff'));
  const font = await pdf.embedFont(await fontBytes, { subset: true });
  pdf.setTitle(title);
  pdf.setAuthor('Collective Waste Solutions');
  pdf.setSubject('Blocked-call details and photo evidence');
  const margin = 32, width = 548, bottom = 46, top = 696;
  let page, y;
  const lineHeight = 11.5, size = 9;
  function lines(value, textSize, availableWidth) {
    const result = [];
    for (const paragraph of cleanReportText(value).split(/\r?\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (line && font.widthOfTextAtSize(line + char, textSize) > availableWidth) {
          const split = line.lastIndexOf(' ');
          if (split > line.length / 2) {
            result.push(line.slice(0, split)); line = line.slice(split + 1) + char;
          } else { result.push(line); line = char; }
        } else line += char;
      }
      result.push(line);
    }
    return result;
  }
  function draw(value, x, baseline, textSize = size, color = INK) {
    if (value) page.drawText(value, { x, y: baseline, size: textSize, font, color });
  }
  function newPage() {
    page = pdf.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 784, width: 612, height: 8, color: GREEN });
    draw('COLLECTIVE WASTE SOLUTIONS', margin, 760, 9, GREEN);
    draw(title, margin, 738, 18, GREEN);
    draw(context, margin, 720, 9, MUTED);
    page.drawLine({ start: { x: margin, y: 709 }, end: { x: 580, y: 709 }, thickness: .5, color: rgb(.8, .84, .83) });
    y = top;
  }
  function heading(reference, continued = false) {
    const wrapped = lines(reference + (continued ? ' (continued)' : ''), 10, width - 12);
    const height = wrapped.length * 13 + 8;
    page.drawRectangle({ x: margin, y: y - height, width, height, color: rgb(.92, .96, .94) });
    wrapped.forEach((line, index) => draw(line, margin + 6, y - 14 - index * 13, 10, GREEN));
    y -= height + 5;
  }
  function continueReport(reference) { newPage(); heading(reference, true); }
  newPage();
  if (!entries.length) draw('No blocked calls were recorded for this date at preparation time.', margin, y - 12, 10);

  for (const entry of entries) {
    const reference = cleanReportText(entry.report.reference_number);
    const rows = blockedCallDetailRows(entry).map((row) => {
      const cellWidth = row.length === 2 ? (width - 14) / 2 : width;
      const cells = row.map(([label, value]) => lines(label + ': ' + value, size, cellWidth));
      return { cells, cellWidth, count: Math.max(...cells.map((cell) => cell.length)) };
    });
    const photos = await reportPhotoCopies(entry, directory, budget);
    const columns = photos.length <= 2 ? 2 : 3;
    const photoWidth = (width - (columns - 1) * 10) / columns;
    const photoHeight = columns === 2 ? 130 : 104;
    const photoRows = [];
    for (let start = 0; start < photos.length; start += columns) {
      const items = photos.slice(start, start + columns).map((photo, index) => ({
        photo, caption: lines('Photo ' + (start + index + 1) + ': ' + photo.file_name, 7.5, photoWidth),
      }));
      photoRows.push({ items, height: photoHeight + Math.max(...items.map((item) => item.caption.length)) * 9 + 7 });
    }
    const headingHeight = lines(reference, 10, width - 12).length * 13 + 13;
    const height = headingHeight + rows.reduce((sum, row) => sum + row.count * lineHeight + 2, 0) +
      5 + photoRows.reduce((sum, row) => sum + row.height, 0) + 12;
    // Keep an ordinary report together; long notes and larger photo sets flow.
    if (y < top && y - Math.min(height, top - bottom) < bottom) newPage();
    heading(reference);
    for (const row of rows) {
      if (row.count * lineHeight + 2 <= top - bottom - headingHeight && y - row.count * lineHeight - 2 < bottom) continueReport(reference);
      for (let index = 0; index < row.count; index++) {
        if (y - lineHeight < bottom) continueReport(reference);
        row.cells.forEach((cell, column) => draw(cell[index], margin + column * (row.cellWidth + 14), y - 9));
        y -= lineHeight;
      }
      y -= 2;
    }
    y -= 5;
    for (const row of photoRows) {
      if (y - row.height < bottom) continueReport(reference);
      for (const [column, item] of row.items.entries()) {
        const image = await pdf.embedJpg(item.photo.content);
        const dimensions = image.scaleToFit(photoWidth, photoHeight);
        const x = margin + column * (photoWidth + 10);
        page.drawImage(image, { x: x + (photoWidth - dimensions.width) / 2,
          y: y - dimensions.height, width: dimensions.width, height: dimensions.height });
        item.caption.forEach((line, index) => draw(line, x, y - photoHeight - 10 - index * 9, 7.5, MUTED));
      }
      y -= row.height;
    }
    y -= 12;
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 33 }, end: { x: 580, y: 33 }, thickness: .5, color: rgb(.8, .84, .83) });
    item.drawText('CM Reporting', { x: margin, y: 20, size: 8, font, color: MUTED });
    const number = (index + 1) + ' / ' + pages.length;
    item.drawText(number, { x: 580 - font.widthOfTextAtSize(number, 8), y: 20, size: 8, font, color: MUTED });
  });
  const content = Buffer.from(await pdf.save());
  if (content.length > MAX_PDF_BYTES) throw attachmentError(new Error(`Prepared PDF is ${content.length} bytes; the attachment limit is ${MAX_PDF_BYTES} bytes.`));
  return content;
}

/** Compact individual report with all saved photos embedded. */
export async function blockedCallAttachments(database, directory, reportId, maxImageBytes = MAX_IMAGE_BYTES) {
  try {
    const entry = blockedCallReport(database, reportId);
    if (!entry) return [];
    const content = await compactBlockedCallPdf([entry], directory, 'Blocked-call report',
      'Times: America/Edmonton. ' + entry.photos.length + ' photos.', maxImageBytes);
    const filename = String(entry.report.reference_number).replace(/[^a-zA-Z0-9_-]/g, '_') + '-blocked-call.pdf';
    return [{ filename, content, contentType: 'application/pdf' }];
  } catch (error) { throw attachmentError(error); }
}

/** One calendar day only. Every report/photo must fit; failures never omit evidence. */
export async function dailyBlockedCallAttachments(database, directory, reportIds, day) {
  try {
    const entries = dailyBlockedCallReports(database, reportIds, day);
    const photoCount = entries.reduce((count, entry) => count + entry.photos.length, 0);
    const content = await compactBlockedCallPdf(entries, directory, 'Daily blocked-call report',
      day + '   |   America/Edmonton   |   ' + entries.length + ' calls   |   ' + photoCount + ' photos',
      reportImageBudget(entries));
    return [{ filename: 'blocked-calls-' + day + '.pdf', content, contentType: 'application/pdf' }];
  } catch (error) { throw attachmentError(error); }
}
