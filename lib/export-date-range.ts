function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function exportDateRangeError(from: string, to: string, requireBoth = false) {
  if (requireBoth && (!from || !to)) return 'Choose both a start date and an end date.';
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) return 'Enter valid start and end dates.';
  if (from && to && from > to) return 'The end date must be on or after the start date.';
  return '';
}
