import { isCalendarDate } from './report-filters';
import { edmontonDateKey } from './report-time';

export interface ReportWeek { start: string; total: number }
export interface ReportWeeks { weeks: ReportWeek[]; total: number }

// Work with calendar dates, not UTC conversions of Mountain report timestamps.
export function reportingWeekStart(dateKey = edmontonDateKey()) {
  if (!isCalendarDate(dateKey)) throw new Error('Invalid reporting date.');
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function reportingWeekEnd(start: string) {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

export function reportingWeekLabel(start: string) {
  const format = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return format.formatRange(new Date(`${start}T12:00:00Z`), new Date(`${reportingWeekEnd(start)}T12:00:00Z`));
}

export function reportingWeekQuery(query: string, start: string, today = edmontonDateKey()) {
  const params = new URLSearchParams(query);
  const from = [start, params.get('from') || start].sort().at(-1)!;
  const to = [reportingWeekEnd(start), params.get('to') || today, today].sort()[0];
  params.set('dateMode', from === to ? 'day' : 'range');
  params.set('from', from);
  params.set('to', to);
  return params.toString();
}
