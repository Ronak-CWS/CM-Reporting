import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import decodeHeic from 'heic-decode';
import { privatePhotoPath } from './photo-path.ts';
import { blockedCallReport, dailyBlockedCallReports, blockedCallDetailRows, cleanReportText } from './blocked-call-report.js';
import { reportAttachmentLimitBytes, reportSizeError } from './report-limits.js';

const MAX_IMAGE_BYTES = 600 * 1024;
// Start close to the available image budget so busy days do not encode every
// photo at several sizes that cannot fit. Preserve detail down to 384 pixels;
// never silently omit evidence or shrink it without a lower bound.
const IMAGE_PROFILES = [
  { size: 1600, quality: 80, minimumBudget: 300 * 1024 },
  { size: 1280, quality: 72, minimumBudget: 180 * 1024 },
  { size: 1024, quality: 60, minimumBudget: 100 * 1024 },
  { size: 800, quality: 50, minimumBudget: 60 * 1024 },
  { size: 640, quality: 45, minimumBudget: 30 * 1024 },
  { size: 512, quality: 42, minimumBudget: 18 * 1024 },
  { size: 384, quality: 38, minimumBudget: 0 },
];
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
  const firstProfile = IMAGE_PROFILES.findIndex(({ minimumBudget }) => maxBytes >= minimumBudget);
  for (const { size, quality } of IMAGE_PROFILES.slice(Math.max(0, firstProfile))) {
    const result = await sharp(source, options)
      .rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (result.length <= maxBytes) return result;
  }
  throw attachmentError(reportSizeError(`The resized photo exceeds the ${maxBytes}-byte image budget within the configured report limit.`));
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

export function reportImageBudget(entries, maxReportBytes = reportAttachmentLimitBytes()) {
  const photoCount = entries.reduce((count, entry) => count + entry.photos.length, 0);
  // One shared font and a modest allowance for text/structure, then all images.
  const budget = Math.min(MAX_IMAGE_BYTES, Math.floor((maxReportBytes - 131072 - entries.length * 4096) / Math.max(1, photoCount)));
  if (budget <= 0) throw attachmentError(reportSizeError(`The daily report has no remaining photo budget within the ${maxReportBytes}-byte attachment limit.`));
  return budget;
}

async function compactBlockedCallPdf(entries, directory, title, context, budget, maxReportBytes = reportAttachmentLimitBytes()) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  fontBytes ||= readFile(path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.woff'));
  const font = await pdf.embedFont(await fontBytes, { subset: true });
  pdf.setTitle(title);
  pdf.setAuthor('Collective Waste Solutions');
  pdf.setSubject('Blocked-call details and photo evidence');
  const margin = 32, width = 548, bottom = 46;
  const pageWidth = 612, pageHeight = 792, headerHeight = 96;
  const photoColumnWidth = 190, columnGap = 16, detailWidth = width - photoColumnWidth - columnGap;
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
  function newPage(height = pageHeight) {
    page = pdf.addPage([pageWidth, height]);
    page.drawRectangle({ x: 0, y: height - 8, width: pageWidth, height: 8, color: GREEN });
    draw('COLLECTIVE WASTE SOLUTIONS', margin, height - 32, 9, GREEN);
    draw(title, margin, height - 54, 18, GREEN);
    draw(context, margin, height - 72, 9, MUTED);
    page.drawLine({ start: { x: margin, y: height - 83 }, end: { x: 580, y: height - 83 }, thickness: .5, color: rgb(.8, .84, .83) });
    y = height - headerHeight;
  }
  function heading(reference) {
    const wrapped = lines(reference, 10, width - 12);
    const height = wrapped.length * 13 + 8;
    page.drawRectangle({ x: margin, y: y - height, width, height, color: rgb(.92, .96, .94) });
    wrapped.forEach((line, index) => draw(line, margin + 6, y - 14 - index * 13, 10, GREEN));
    y -= height + 5;
  }
  if (!entries.length) {
    newPage();
    draw('No blocked calls were recorded for this date at preparation time.', margin, y - 12, 10);
  }

  for (const entry of entries) {
    const reference = cleanReportText(entry.report.reference_number);
    const rows = blockedCallDetailRows(entry).map((row) => {
      const cellWidth = row.length === 2 ? (detailWidth - 14) / 2 : detailWidth;
      const cells = row.map(([label, value]) => lines(label + ': ' + value, size, cellWidth));
      return { cells, cellWidth, count: Math.max(...cells.map((cell) => cell.length)) };
    });
    const photos = await reportPhotoCopies(entry, directory, budget);
    const columns = photos.length === 1 ? 1 : 2;
    const photoWidth = (photoColumnWidth - (columns - 1) * 10) / columns;
    const photoHeight = columns === 1 ? 112 : 100;
    const photoRows = [];
    for (let start = 0; start < photos.length; start += columns) {
      const items = photos.slice(start, start + columns).map((photo, index) => ({
        photo, caption: lines('Photo ' + (start + index + 1) + ': ' + photo.file_name, 7.5, photoWidth),
      }));
      photoRows.push({ items, height: photoHeight + Math.max(...items.map((item) => item.caption.length)) * 9 + 5 });
    }
    const headingHeight = lines(reference, 10, width - 12).length * 13 + 13;
    const bodyHeight = Math.max(rows.reduce((sum, row) => sum + row.count * lineHeight + 2, 0),
      photoRows.reduce((sum, row) => sum + row.height, 0));
    const height = headingHeight + bodyHeight + 8;
    // Place a whole record, including every photo and caption, before drawing.
    // Exceptional notes get one taller page instead of tiny text, truncation or
    // continuation pages. Ordinary records retain US Letter pages.
    if (!page || y - height < bottom) newPage(Math.max(pageHeight, Math.ceil(headerHeight + height + bottom)));
    const recordTop = y;
    heading(reference);
    let detailY = y;
    let photoY = y;
    for (const row of rows) {
      for (let index = 0; index < row.count; index++) {
        row.cells.forEach((cell, column) => draw(cell[index], margin + column * (row.cellWidth + 14), detailY - 9));
        detailY -= lineHeight;
      }
      detailY -= 2;
    }
    for (const row of photoRows) {
      for (const [column, item] of row.items.entries()) {
        const image = await pdf.embedJpg(item.photo.content);
        const dimensions = image.scaleToFit(photoWidth, photoHeight);
        const x = margin + detailWidth + columnGap + column * (photoWidth + 10);
        page.drawImage(image, { x: x + (photoWidth - dimensions.width) / 2,
          y: photoY - dimensions.height, width: dimensions.width, height: dimensions.height });
        item.caption.forEach((line, index) => draw(line, x, photoY - photoHeight - 9 - index * 9, 7.5, MUTED));
      }
      photoY -= row.height;
    }
    y = recordTop - height;
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 33 }, end: { x: 580, y: 33 }, thickness: .5, color: rgb(.8, .84, .83) });
    item.drawText('CM Reporting', { x: margin, y: 20, size: 8, font, color: MUTED });
    const number = (index + 1) + ' / ' + pages.length;
    item.drawText(number, { x: 580 - font.widthOfTextAtSize(number, 8), y: 20, size: 8, font, color: MUTED });
  });
  const content = Buffer.from(await pdf.save());
  if (content.length > maxReportBytes) throw attachmentError(reportSizeError(`Prepared PDF is ${content.length} bytes; the attachment limit is ${maxReportBytes} bytes.`));
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
export async function dailyBlockedCallAttachments(database, directory, reportIds, day, maxReportBytes = reportAttachmentLimitBytes()) {
  try {
    const entries = dailyBlockedCallReports(database, reportIds, day);
    const photoCount = entries.reduce((count, entry) => count + entry.photos.length, 0);
    const content = await compactBlockedCallPdf(entries, directory, 'Daily blocked-call report',
      day + '   |   America/Edmonton   |   ' + entries.length + ' calls   |   ' + photoCount + ' photos',
      reportImageBudget(entries, maxReportBytes), maxReportBytes);
    return [{ filename: 'blocked-calls-' + day + '.pdf', content, contentType: 'application/pdf' }];
  } catch (error) { throw attachmentError(error); }
}
