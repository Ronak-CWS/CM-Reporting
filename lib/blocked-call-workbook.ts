import ExcelJS from 'exceljs';
import { blockedCallDetailRows, cleanReportText, dailyBlockedCallReports } from './blocked-call-report.js';
import { reportImageBudget, reportPhotoCopies } from './report-attachment.js';
import { reportAttachmentLimitBytes, reportSizeError } from './report-limits.js';
import type { DatabaseSync } from 'node:sqlite';

const GREEN = 'FF0A5947';
const INK = 'FF203139';
const PALE = 'FFEBF4EF';
// OOXML 1 is US Letter; ExcelJS omits Letter from its TypeScript enum.
const LETTER = 1 as ExcelJS.PaperSize;

function wrap(value: string, width: number) {
  const result: string[] = [];
  for (const paragraph of cleanReportText(value).split(/\r?\n/)) {
    let remaining = paragraph;
    while (remaining.length > width) {
      const space = remaining.lastIndexOf(' ', width);
      const end = space > width / 2 ? space : width;
      result.push(remaining.slice(0, end));
      remaining = remaining.slice(end + (remaining[end] === ' ' ? 1 : 0));
    }
    result.push(remaining);
  }
  return result;
}

/** Photo-inclusive daily workbook; existing register exports remain available. */
export async function dailyBlockedCallWorkbook(database: DatabaseSync, directory: string, ids: string[], day: string) {
  try {
    const maxReportBytes = reportAttachmentLimitBytes();
    const entries = dailyBlockedCallReports(database, ids, day);
    const photoCount = entries.reduce((total, entry) => total + entry.photos.length, 0);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Collective Waste Solutions';
    workbook.title = `Daily blocked-call report - ${day}`;
    const margins = { left: .35, right: .35, top: .35, bottom: .35, header: .15, footer: .15 };
    const summary = workbook.addWorksheet('Summary', {
      properties: { tabColor: { argb: GREEN } },
      views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
      pageSetup: { paperSize: LETTER, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        printTitlesRow: '1:4', margins },
    });
    const details = workbook.addWorksheet('Details and photos', {
      views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
      pageSetup: { paperSize: LETTER, orientation: 'portrait', scale: 100, printTitlesRow: '1:3', margins },
    });
    summary.columns = [25, 8, 19, 27, 23, 17, 15, 10].map((width) => ({ width }));
    details.columns = Array.from({ length: 12 }, () => ({ width: 8 }));
    for (const sheet of [summary, details]) {
      sheet.getRow(1).height = 7;
      sheet.getRow(2).height = 23;
      sheet.getCell('A2').value = sheet === summary ? 'Daily blocked-call report' : 'Blocked-call details and photos';
      sheet.getCell('A2').font = { name: 'Arial', size: 15, bold: true, color: { argb: GREEN } };
      sheet.getCell('A3').value = `${day}. ${entries.length} calls. ${photoCount} photos. Times: America/Edmonton.`;
      sheet.getCell('A3').font = { name: 'Arial', size: 10, color: { argb: INK } };
      sheet.getRow(3).height = 20;
      sheet.headerFooter.oddFooter = '&LCM Reporting&RPage &P of &N';
    }
    const header = summary.getRow(4);
    header.values = ['Reference', 'Time', 'Community', 'Location', 'Reason', 'Reported by', 'Status / priority', 'Photos'];
    header.height = 28;
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    });
    let detailRow = 4;
    let pageHeight = 0;
    const usableHeight = 660;
    const imageBudget = reportImageBudget(entries);
    function band(reference: string, continued = false) {
      const row = details.getRow(detailRow);
      details.mergeCells(detailRow, 1, detailRow, 12);
      row.getCell(1).value = reference + (continued ? ' (continued)' : '');
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
      row.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: GREEN } };
      row.getCell(1).alignment = { vertical: 'middle' };
      row.height = 21;
      detailRow++; pageHeight += 21;
    }
    function nextPage(reference: string) {
      details.getRow(detailRow - 1).addPageBreak();
      pageHeight = 0;
      band(reference, true);
    }
    for (const [index, entry] of entries.entries()) {
      const { report, blockage } = entry;
      const fields = blockedCallDetailRows(entry).flatMap((fields) => {
        const lines = fields.map(([label, value]) => wrap(`${label}: ${value}`, fields.length === 2 ? 55 : 112));
        const count = Math.max(...lines.map((lines) => lines.length));
        const rows = [];
        // Split exceptionally long notes into readable rows; Excel caps row height.
        for (let start = 0; start < count; start += 24) {
          const values = lines.map((lines) => lines.slice(start, start + 24).join('\n'));
          rows.push({ values, height: Math.min(24, count - start) * 12.5 + 3 });
        }
        return rows;
      });
      const photos = await reportPhotoCopies(entry, directory, imageBudget);
      const columns = photos.length <= 2 ? 2 : 3;
      const imageHeight = columns === 2 ? 130 : 104;
      const imageRows = [];
      for (let start = 0; start < photos.length; start += columns) {
        const items = photos.slice(start, start + columns).map((photo, offset) => ({
          photo, caption: wrap(`Photo ${start + offset + 1}: ${photo.file_name}`, columns === 2 ? 55 : 35),
        }));
        imageRows.push({ items, captionHeight: Math.max(...items.map((item) => item.caption.length)) * 11 + 3 });
      }
      const height = 21 + fields.reduce((sum, row) => sum + row.height, 0) +
        imageRows.reduce((sum, row) => sum + imageHeight + row.captionHeight, 0) + 8;
      if (pageHeight && pageHeight + Math.min(height, usableHeight) > usableHeight) {
        details.getRow(detailRow - 1).addPageBreak(); pageHeight = 0;
      }
      const anchorRow = detailRow;
      band(cleanReportText(report.reference_number));
      for (const field of fields) {
        if (pageHeight + field.height > usableHeight) nextPage(report.reference_number);
        details.getRow(detailRow).height = field.height;
        field.values.forEach((value, column) => {
          const span = 12 / field.values.length;
          const first = column * span + 1;
          details.mergeCells(detailRow, first, detailRow, first + span - 1);
          const cell = details.getCell(detailRow, first);
          cell.value = value;
          cell.font = { name: 'Arial', size: 10, color: { argb: INK } };
          cell.alignment = { wrapText: true, vertical: 'top' };
        });
        detailRow++; pageHeight += field.height;
      }
      for (const imageRow of imageRows) {
        if (pageHeight + imageHeight + imageRow.captionHeight > usableHeight) nextPage(report.reference_number);
        details.getRow(detailRow).height = imageHeight;
        details.getRow(detailRow + 1).height = imageRow.captionHeight;
        for (const [column, item] of imageRow.items.entries()) {
          const span = 12 / columns;
          // Excel column width 8 is 61 screen pixels in the standard font metrics.
          const availableWidth = span * 61 - 10;
          const scale = Math.min(availableWidth / item.photo.width, imageHeight * 4 / 3 / item.photo.height);
          const width = item.photo.width * scale;
          const heightPx = item.photo.height * scale;
          const imageId = workbook.addImage({ buffer: item.photo.content as unknown as ExcelJS.Buffer, extension: 'jpeg' });
          details.addImage(imageId, { tl: { col: column * span + (availableWidth - width) / 2 / 61, row: detailRow - 1 },
            ext: { width, height: heightPx }, editAs: 'oneCell' });
          details.mergeCells(detailRow + 1, column * span + 1, detailRow + 1, (column + 1) * span);
          const cell = details.getCell(detailRow + 1, column * span + 1);
          cell.value = item.caption.join('\n');
          cell.font = { name: 'Arial', size: 9, color: { argb: 'FF616F75' } };
          cell.alignment = { wrapText: true, vertical: 'top' };
        }
        detailRow += 2; pageHeight += imageHeight + imageRow.captionHeight;
      }
      details.getRow(detailRow++).height = 8;
      pageHeight += 8;
      const row = summary.addRow([
        { text: cleanReportText(report.reference_number), hyperlink: `#'Details and photos'!A${anchorRow}` },
        new Date(`${report.occurred_at.slice(0, 19)}Z`), report.registered_community,
        report.site_address || report.customer_address, blockage.reason_label, report.employee_name,
        `${report.status} / ${report.priority}`, photos.length,
      ]);
      row.height = 30;
      row.eachCell((cell, column) => {
        cell.font = { name: 'Arial', size: 10, color: { argb: column === 1 ? GREEN : INK }, underline: column === 1 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF4F7F5' : 'FFFFFFFF' } };
        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: column === 8 ? 'right' : 'left' };
      });
      row.getCell(2).numFmt = 'hh:mm';
      // Summary cells must remain fully readable for unusually long addresses.
      const longest = [report.reference_number, '', report.registered_community, report.site_address || report.customer_address,
        blockage.reason_label, report.employee_name, `${report.status} / ${report.priority}`, '']
        .reduce((lines, value, column) => Math.max(lines, wrap(String(value || ''), Math.max(8, (summary.getColumn(column + 1).width || 12) - 4)).length), 1);
      row.height = Math.max(30, Math.min(409, longest * 12.5 + 5));
    }
    if (!entries.length) {
      summary.getCell('A5').value = 'No blocked calls recorded for this date.';
      details.getCell('A4').value = 'No blocked calls recorded for this date.';
    }
    summary.autoFilter = { from: 'A4', to: `H${Math.max(4, entries.length + 4)}` };
    summary.pageSetup.printArea = `A1:H${Math.max(5, entries.length + 4)}`;
    details.pageSetup.printArea = `A1:L${Math.max(4, detailRow - 1)}`;
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    if (content.length > maxReportBytes) throw reportSizeError(`Prepared Excel report is ${content.length} bytes; the attachment limit is ${maxReportBytes} bytes.`);
    return [{ filename: `blocked-calls-${day}.xlsx`, content,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }];
  } catch (error) {
    throw Object.assign(new Error('The Excel report could not be prepared with all of its photos.', { cause: error }), { code: 'EATTACHMENT' });
  }
}
