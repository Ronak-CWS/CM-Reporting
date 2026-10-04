import { listReportRecords } from '../../../lib/reporting-store';
import { accessResponse } from '../../../lib/request-access';
import type { ReportRecord } from '../../../lib/report-types';
import { exportDateRangeError } from '../../../lib/export-date-range';
import { reportDescription } from '../../../lib/report-description';

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
    reportDescription(record),
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
    'Blockage Scope',
    'Blocked Call Reason',
    'Street Section From',
    'Street Section To',
    'Vehicle Plates',
    'Photo Count',
    'Photo Files',
    'Photo Paths (open on CM Reporting)',
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
    reportDescription(record),
    record.rootCause,
    record.correctiveAction,
    record.resolutionDescription,
    record.resolutionDueAt,
    record.resolvedAt,
    record.assignedTo,
    record.employeeName,
    record.blockage?.scope === 'street' ? 'Street block' : record.blockage?.scope === 'pickup' ? 'Pickup location' : '',
    record.blockage?.reasonLabel || '',
    record.blockage?.streetFrom || '',
    record.blockage?.streetTo || '',
    record.blockage?.vehiclePlates || '',
    record.photos.length,
    record.photos.map((photo) => photo.fileName).join(' | '),
    record.photos.map((photo) => photo.url).join(' | '),
  ]);

  return buildCsv(headers, rows);
}

export async function GET(request: Request) {
  const denied = accessResponse(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const exportType = url.searchParams.get('type') === 'complaints' ? 'complaints' : 'daily';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const rangeError = exportDateRangeError(from, to);
  if (rangeError) return Response.json({ error: rangeError }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
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
