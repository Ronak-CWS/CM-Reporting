import { describe, expect, it } from 'vitest';
import { reportingWeekStart, reportingWeekEnd, reportingWeekQuery } from '../lib/report-weeks';

describe('reporting weeks', () => {
  it.each([
    ['2026-10-25', '2026-10-19', '2026-10-25'],
    ['2026-10-26', '2026-10-26', '2026-11-01'],
    ['2026-11-01', '2026-10-26', '2026-11-01'],
    ['2026-01-01', '2025-12-29', '2026-01-04'],
  ])('groups %s into a Monday-Sunday week', (date, start, end) => {
    expect(reportingWeekStart(date)).toBe(start);
    expect(reportingWeekEnd(start)).toBe(end);
  });

  it('intersects a week with the selected range and never requests future dates', () => {
    const current = new URLSearchParams(reportingWeekQuery('type=complaint&dateMode=all&status=Open&q=Brooks', '2026-10-26', '2026-10-27'));
    expect(Object.fromEntries(current)).toMatchObject({ type: 'complaint', status: 'Open', q: 'Brooks', dateMode: 'range', from: '2026-10-26', to: '2026-10-27' });
    const single = new URLSearchParams(reportingWeekQuery('type=daily&dateMode=range&from=2026-10-27&to=2026-10-29', '2026-10-26', '2026-10-27'));
    expect(Object.fromEntries(single)).toMatchObject({ dateMode: 'day', from: '2026-10-27', to: '2026-10-27' });
  });
});
