import { listReportRecords } from '../../../lib/reporting-store';
import type { ReportRecord } from '../../../lib/report-types';

export const dynamic = 'force-dynamic';

function csvCell(value: unknown) {
  const normalized = String(value ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return `"${normalized.replaceAll('"', '""')}"`;
}

function buildCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach((row) => lines.push(row.map(csvCell).join(',')));
  return `\uFEFF${lines.join('\r\n')}`;
}

function withinRange(record: ReportRecord, from: string, to: string) {
  const recordDate = record.occurredAt.slice(0, 10);
  return (!from || recordDate >= from) && (!to || recordDate <= to);
}

function exhibitSevenCsv(records: ReportRecord[]) {
  const headers = [
    'No.',
    'Registered Community',
    'Date and Time of Inquiry or Complaint',
    'Contact Medium (e.g., call, email, live-chat)',
    'Contractor Employee Name',
    'Contractor Employee Title',
    'Person Making Inquiry or Complaint Name',
    'Person Making Inquiry or Complaint Address',
    'Person Making Inquiry or Complaint Contact Information',
    'Description of Inquiry or Complaint',
    'Description of Resolution',
    'Date and Time of Resolution',
  ];
  const rows = records.map((record, index) => [
    index + 1,
    record.registeredCommunity,
    record.occurredAt,
    record.contactMedium,
    record.employeeName,
    record.employeeTitle,
    record.customerName,
    record.customerAddress,
    record.customerContactInformation,
    record.issueDescription,
    record.resolutionDescription,
    record.resolvedAt,
  ]);

  return buildCsv(headers, rows);
}

function dailySummaryCsv(records: ReportRecord[]) {
  const headers = [
    'Reference',
    'Registered Community',
    'Date and Time',
    'Record Type',
    'Category',
    'Priority',
    'Status',
    'Site Address',
    'Route',
    'Service Type',
    'Description',
    'Root Cause',
    'Corrective Action',
    'Resolution',
    'Resolution Due',
    'Resolved At',
    'Assigned To',
    'Logged By',
  ];
  const rows = records.map((record) => [
    record.referenceNumber,
    record.registeredCommunity,
    record.occurredAt,
    record.recordType === 'complaint' ? 'Complaint' : 'Daily operational report',
    record.category,
    record.priority,
    record.status,
    record.siteAddress,
    record.routeNumber,
    record.serviceType,
    record.issueDescription,
    record.rootCause,
    record.correctiveAction,
    record.resolutionDescription,
    record.resolutionDueAt,
    record.resolvedAt,
    record.assignedTo,
    record.employeeName,
  ]);

  return buildCsv(headers, rows);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exportType = url.searchParams.get('type') === 'complaints' ? 'complaints' : 'daily';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const records = (await listReportRecords()).filter((record) => withinRange(record, from, to));
  const filteredRecords = exportType === 'complaints'
    ? records.filter((record) => record.recordType === 'complaint')
    : records;
  const csv = exportType === 'complaints'
    ? exhibitSevenCsv(filteredRecords)
    : dailySummaryCsv(filteredRecords);
  const rangeLabel = [from, to].filter(Boolean).join('_to_') || new Date().toISOString().slice(0, 10);
  const filename = exportType === 'complaints'
    ? `CM_Exhibit_7_Complaints_${rangeLabel}.csv`
    : `CM_Daily_Summary_${rangeLabel}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
