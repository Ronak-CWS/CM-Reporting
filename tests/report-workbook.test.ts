import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { reportWorkbook } from '../lib/report-workbook';
import type { ReportRecord } from '../lib/report-types';

const record: ReportRecord = {
  id: 'example', referenceNumber: 'CM-CMP-20261004-ABC123', recordType: 'complaint',
  occurredAt: '2026-10-04T14:30', reportedAt: '2026-10-04T20:30:00Z',
  registeredCommunity: 'Brooks', siteAddress: '', routeNumber: '0012', serviceType: '',
  category: 'Other', categoryOtherReason: 'Collection schedule question', priority: 'High', status: 'Resolved',
  contactMedium: 'Phone call', employeeName: 'Test employee', employeeTitle: 'Dispatcher',
  customerName: '', customerAddress: '123 Example Avenue, Unit 9', customerContactInformation: '',
  issueDescription: 'A detailed question about the collection schedule.\nThe resident would like a call back.',
  rootCause: '', correctiveAction: '', resolutionDescription: 'Information provided.', resolutionDueAt: '',
  resolvedAt: '2026-10-05T00:30:00Z', assignedTo: '', createdAt: '2026-10-04T20:30:00Z', updatedAt: '2026-10-05T00:30:00Z',
  blockage: null, photos: [],
};
async function read(type: 'complaints' | 'daily', records: ReportRecord[]) {
  const bytes = await reportWorkbook(type, records, '2026-10-04', '2026-10-04');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer as ArrayBuffer);
  return book.worksheets[0];
}

describe('formatted workbooks', () => {
  it('preserves complaint data and the reference column, with filters, frozen headers, wrapping, and Mountain dates', async () => {
    const sheet = await read('complaints', [record, { ...record, id: 'second', referenceNumber: 'CM-CMP-SECOND', status: 'Open', resolvedAt: '' }]);
    expect(sheet.getCell('A5').value).toBe('Reference number');
    expect(sheet.getCell('A6').value).toBe(record.referenceNumber);
    expect(sheet.getCell('G6').value || '').toBe('');
    expect(sheet.getCell('G6').type).toBe(ExcelJS.ValueType.Null);
    expect(sheet.getCell('L7').value).toBeNull();
    expect(sheet.getCell('H6').value).toBe(record.customerAddress);
    expect(sheet.getCell('J6').value).toContain(`Other category reason: ${record.categoryOtherReason}`);
    expect(sheet.getCell('J6').value).toContain(record.issueDescription);
    expect(sheet.getCell('J6').alignment.wrapText).toBe(true);
    expect(sheet.getColumn('J').width).toBe(58);
    expect(sheet.getCell('C6').value).toEqual(new Date('2026-10-04T14:30:00Z'));
    expect(sheet.getCell('L6').value).toEqual(new Date('2026-10-04T18:30:00Z'));
    expect(sheet.getCell('C6').numFmt).toContain('h:mm');
    expect(sheet.getCell('M6').value).toBe('High');
    expect(sheet.getCell('N6').value).toBe('Resolved');
    expect(sheet.getCell('B6').fill).not.toEqual(sheet.getCell('B7').fill);
    expect(sheet.getRow(6).height).toBeGreaterThan(42);
    expect(sheet.autoFilter).toBe('A5:N7');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 5, showGridLines: false });
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', printTitlesRow: '1:5' });
  });
  it('keeps untrusted values as text instead of spreadsheet formulas and preserves leading zeroes', async () => {
    const sheet = await read('daily', [{ ...record, issueDescription: '=HYPERLINK("https://example.invalid","click")' }]);
    expect(sheet.getCell('K6').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('K6').formula).toBeUndefined();
    expect(sheet.getCell('I6').value).toBe('0012');
    expect(sheet.getCell('H6').value).toBe(record.customerAddress);
    expect(sheet.getCell('A6').value).toBe(record.referenceNumber);
  });
  it('creates a valid, clearly labelled workbook when no records match', async () => {
    const sheet = await read('complaints', []);
    expect(sheet.getCell('A3').value).toContain('0 records');
    expect(sheet.getCell('A6').value).toBe('No records match the selected dates.');
    expect(sheet.getCell('A5').value).toBe('Reference number');
    expect(sheet.autoFilter).toBe('A5:N5');
  });
});
