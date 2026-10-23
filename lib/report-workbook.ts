import ExcelJS from 'exceljs';
import { reportDescription } from './report-description';
import { edmontonTimestamp } from './report-time';
import type { ReportRecord } from './report-types';

type ExportType = 'daily' | 'complaints';
interface ExportColumn {
  label: string;
  width: number;
  value: (record: ReportRecord) => string | number;
  date?: boolean;
}
const reference: ExportColumn = { label: 'Reference number', width: 31, value: (r) => r.referenceNumber };
const community: ExportColumn = { label: 'Registered community', width: 24, value: (r) => r.registeredCommunity };
const priority: ExportColumn = { label: 'Priority', width: 13, value: (r) => r.priority };
const status: ExportColumn = { label: 'Status', width: 17, value: (r) => r.status };

const complaintColumns: ExportColumn[] = [
  reference, community,
  { label: 'Inquiry / complaint date and time', width: 26, value: (r) => r.occurredAt, date: true },
  { label: 'Contact medium', width: 18, value: (r) => r.contactMedium },
  { label: 'Employee name', width: 25, value: (r) => r.employeeName },
  { label: 'Employee title', width: 25, value: (r) => r.employeeTitle },
  { label: 'Customer name', width: 25, value: (r) => r.customerName },
  { label: 'Customer address', width: 36, value: (r) => r.customerAddress },
  { label: 'Customer contact information', width: 30, value: (r) => r.customerContactInformation },
  { label: 'Inquiry / complaint description', width: 58, value: reportDescription },
  { label: 'Resolution description', width: 54, value: (r) => r.resolutionDescription },
  { label: 'Resolution date and time', width: 26, value: (r) => r.resolvedAt, date: true },
  priority, status,
];
const dailyColumns: ExportColumn[] = [
  reference, community,
  { label: 'Report date and time', width: 26, value: (r) => r.occurredAt, date: true },
  { label: 'Record type', width: 21, value: (r) => r.recordType === 'complaint' ? 'Complaint' : 'Blocked call' },
  { label: 'Category', width: 24, value: (r) => r.category },
  priority, status,
  { label: 'Address / site', width: 36, value: (r) => r.recordType === 'complaint' ? r.customerAddress : r.siteAddress },
  { label: 'Route', width: 13, value: (r) => r.routeNumber },
  { label: 'Service', width: 17, value: (r) => r.serviceType },
  { label: 'Description', width: 58, value: reportDescription },
  { label: 'Root cause', width: 38, value: (r) => r.rootCause },
  { label: 'Corrective action', width: 48, value: (r) => r.correctiveAction },
  { label: 'Resolution', width: 54, value: (r) => r.resolutionDescription },
  { label: 'Resolution due', width: 26, value: (r) => r.resolutionDueAt, date: true },
  { label: 'Resolved at', width: 26, value: (r) => r.resolvedAt, date: true },
  { label: 'Assigned to', width: 25, value: (r) => r.assignedTo },
  { label: 'Logged by', width: 25, value: (r) => r.employeeName },
  { label: 'Blockage scope', width: 20, value: (r) => r.blockage?.scope === 'street' ? 'Street block' : r.blockage?.scope === 'pickup' ? 'Pickup location' : '' },
  { label: 'Blocked call reason', width: 30, value: (r) => r.blockage?.reasonLabel || '' },
  { label: 'Street section from', width: 30, value: (r) => r.blockage?.streetFrom || '' },
  { label: 'Street section to', width: 30, value: (r) => r.blockage?.streetTo || '' },
  { label: 'Vehicle plates', width: 23, value: (r) => r.blockage?.vehiclePlates || '' },
  { label: 'Photo count', width: 13, value: (r) => r.photos.length },
  { label: 'Photo files', width: 40, value: (r) => r.photos.map((photo) => photo.fileName).join('\n') },
  { label: 'Photo paths (CM Reporting)', width: 55, value: (r) => r.photos.map((photo) => photo.url).join('\n') },
];

// Excel stores date/time as a wall clock with no zone. Preserve Mountain display
// time instead of letting the server's timezone shift a report into another day.
function excelDate(value: string): Date | string {
  if (!value) return '';
  let local = value;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return value;
    local = edmontonTimestamp(parsed);
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?/.exec(local);
  if (!match) return value;
  const date = new Date(`${match[1]}T${match[2] || '00:00'}:${match[3] || '00'}.000Z`);
  return Number.isFinite(date.getTime()) ? date : value;
}

export async function reportWorkbook(type: ExportType, records: ReportRecord[], from: string, to: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Collective Waste Solutions';
  workbook.created = new Date();
  workbook.title = type === 'complaints' ? 'CM Reporting | Exhibit 7 complaints' : 'CM Reporting | Daily summary';
  const columns = type === 'complaints' ? complaintColumns : dailyColumns;
  const sheet = workbook.addWorksheet(type === 'complaints' ? 'Exhibit 7 complaints' : 'Daily summary', {
    properties: { defaultRowHeight: 24, tabColor: { argb: 'FF078494' } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 5, topLeftCell: 'B6', showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, scale: 85, printTitlesRow: '1:5',
      margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 } },
  });
  sheet.columns = columns.map((column) => ({ width: column.width }));
  sheet.getRow(1).height = 12;
  sheet.getCell('A2').value = type === 'complaints' ? 'CM Reporting: Exhibit 7 complaint register' : 'CM Reporting: Daily operational summary';
  sheet.getCell('A2').font = { name: 'Aptos', size: 16, bold: true, color: { argb: 'FF173C50' } };
  sheet.getCell('A2').alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 30;
  const period = from && to ? from === to ? from : `${from} to ${to}` : 'All dates';
  sheet.getCell('A3').value = `${period}. ${records.length.toLocaleString('en-CA')} records. Times: America/Edmonton. Exported ${edmontonTimestamp().slice(0, 16).replace('T', ' ')}.`;
  sheet.getCell('A3').font = { name: 'Aptos', size: 11, color: { argb: 'FF536F7D' } };
  sheet.getRow(3).height = 25;
  sheet.getRow(4).height = 12;
  const header = sheet.getRow(5);
  header.values = columns.map((column) => column.label);
  header.height = 42;
  header.eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173C50' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { right: { style: 'hair', color: { argb: 'FFFFFFFF' } } };
  });
  for (const record of records) {
    const values = columns.map((column) => column.value(record));
    const row = sheet.addRow(values.map((value, column) => value === '' ? null : columns[column].date ? excelDate(String(value)) : value));
    let lines = 1;
    columns.forEach((definition, index) => {
      const column = index + 1;
      const cell = row.getCell(column);
      const text = String(values[column - 1] ?? '');
      const wrappedLines = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / Math.max(8, definition.width - 5))), 0);
      lines = Math.max(lines, wrappedLines);
      cell.font = { name: 'Aptos', size: 11, color: { argb: column === 1 ? 'FF087F8C' : 'FF173C50' }, bold: column === 1 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: (row.number - 6) % 2 ? 'FFF0F7F8' : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDFE9ED' } } };
      cell.alignment = { horizontal: typeof values[column - 1] === 'number' ? 'right' : 'left', vertical: 'top', wrapText: true, indent: 1 };
      cell.numFmt = definition.date ? 'mmm d, yyyy h:mm AM/PM' : typeof values[column - 1] === 'number' ? '#,##0' : '@';
      if (definition === status || definition === priority) {
        const urgent = text === 'Urgent' || text === 'High' || text === 'Open';
        const positive = text === 'Resolved';
        cell.font = { ...cell.font, bold: true, color: { argb: positive ? 'FF14724E' : urgent ? 'FF9E312D' : 'FF405E70' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: positive ? 'FFE4F3EA' : urgent ? 'FFFCEBE8' : 'FFEAF0F3' } };
      }
    });
    // Excel's row-height limit is 409 pt. Longer text remains complete in the cell.
    row.height = Math.min(409, Math.max(42, lines * 15 + 12));
  }
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, sheet.rowCount), column: columns.length } };
  if (!records.length) {
    sheet.mergeCells(6, 1, 6, 5);
    sheet.getCell('A6').value = 'No records match the selected dates.';
    sheet.getCell('A6').font = { name: 'Aptos', size: 11, italic: true, color: { argb: 'FF536F7D' } };
    sheet.getRow(6).height = 32;
  }
  sheet.headerFooter.oddFooter = '&LCM Reporting&CPage &P of &N&RCollective Waste Solutions';
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
