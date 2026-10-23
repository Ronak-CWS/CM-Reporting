import { edmontonDateKey } from './report-time';
import type { RecordPriority, RecordStatus, RecordType, ReportRecord } from './report-types';

export const RECORD_PAGE_SIZE = 50;
export const STATUSES: RecordStatus[] = ['Open', 'In progress', 'Resolved'];
export const PRIORITIES: RecordPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
export type DateMode = 'all' | 'day' | 'range';
export interface DateFilter { mode: DateMode; from: string; to: string }
export interface ReportFilters {
  type?: RecordType;
  status?: RecordStatus;
  priority?: RecordPriority;
  search?: string;
  from?: string;
  to?: string;
}
export interface ReportPage { records: ReportRecord[]; total: number; nextCursor: string | null }
export interface ReportingOverview {
  todayRecords: number; todayCommunities: number; openActions: number; flaggedActions: number;
  todayComplaints: number; acknowledgedComplaints: number; resolvedToday: number;
}
export const EMPTY_OVERVIEW: ReportingOverview = {
  todayRecords: 0, todayCommunities: 0, openActions: 0, flaggedActions: 0,
  todayComplaints: 0, acknowledgedComplaints: 0, resolvedToday: 0,
};

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateFilterError(value: DateFilter, today = edmontonDateKey()) {
  if (value.mode === 'all') return '';
  if (!value.from || (value.mode === 'range' && !value.to)) {
    return value.mode === 'day' ? 'Select a date.' : 'Select both a start date and an end date.';
  }
  if (!isCalendarDate(value.from) || (value.mode === 'range' && !isCalendarDate(value.to))) return 'Enter valid calendar dates.';
  if (value.from > today || (value.mode === 'range' && value.to > today)) return 'Dates cannot be later than today.';
  if (value.mode === 'range' && value.from >= value.to) return 'The start date must be before the end date. Use Select a date for one day.';
  return '';
}

export function dateFilterParams(value: DateFilter) {
  const params = new URLSearchParams({ dateMode: value.mode });
  if (value.mode !== 'all') {
    params.set('from', value.from);
    params.set('to', value.mode === 'day' ? value.from : value.to);
  }
  return params;
}

// Shared by register queries and downloads so a filtered export uses identical dates.
export function parseReportFilters(params: URLSearchParams): ReportFilters {
  for (const key of ['type', 'status', 'priority', 'q', 'from', 'to', 'dateMode', 'cursor']) {
    if (params.getAll(key).length > 1) throw new Error(`Supply only one ${key} filter.`);
  }
  const type = params.get('type') || '';
  const status = params.get('status') || '';
  const priority = params.get('priority') || '';
  const search = (params.get('q') || '').trim();
  if (type && type !== 'daily' && type !== 'complaint') throw new Error('Choose a valid record type.');
  if (status && !STATUSES.includes(status as RecordStatus)) throw new Error('Choose a valid status.');
  if (priority && !PRIORITIES.includes(priority as RecordPriority)) throw new Error('Choose a valid priority.');
  if (search.length > 250) throw new Error('Keep searches to 250 characters or fewer.');
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const mode = params.get('dateMode') || (from || to ? from === to ? 'day' : 'range' : 'all');
  if (!['all', 'day', 'range'].includes(mode)) throw new Error('Choose a date or a date range.');
  if (mode === 'all' && (from || to)) throw new Error('Choose a date filter to apply dates.');
  if (mode === 'day' && to && from !== to) throw new Error('Select a date must use the same day.');
  const error = dateFilterError({ mode: mode as DateMode, from, to });
  if (error) throw new Error(error);
  return {
    ...(type ? { type: type as RecordType } : {}),
    ...(status ? { status: status as RecordStatus } : {}),
    ...(priority ? { priority: priority as RecordPriority } : {}),
    ...(search ? { search } : {}),
    ...(mode !== 'all' ? { from, to: mode === 'day' ? from : to } : {}),
  };
}
