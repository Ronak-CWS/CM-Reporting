import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDateRangeError } from '../lib/export-date-range';

const { listRecords } = vi.hoisted(() => ({ listRecords: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/reporting-store', () => ({ listReportRecords: listRecords }));
import { GET } from '../app/api/export/route';

beforeEach(() => { listRecords.mockClear(); });

describe('export date validation', () => {
  it.each([
    ['daily', '2026-09-24', '2026-09-21'],
    ['complaints', '2026-09-01', '2025-05-24'],
    ['daily', '2026-02-29', '2026-03-01'],
    ['complaints', 'not-a-date', '2026-09-24'],
  ])('rejects invalid %s export dates before loading records', async (type, from, to) => {
    const response = await GET(new Request(`https://cm.test/api/export?type=${type}&from=${from}&to=${to}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect((await response.json() as { error: string }).error).toBeTruthy();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it('allows same-day and valid leap-day exports and keeps unbounded API exports compatible', async () => {
    for (const query of ['from=2026-09-24&to=2026-09-24', 'from=2024-02-29&to=2024-03-01', '']) {
      const response = await GET(new Request(`https://cm.test/api/export?type=daily&${query}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/csv');
    }
    expect(exportDateRangeError('', '2026-09-24', true)).toBe('Choose both a start date and an end date.');
  });
});
