// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterView } from '../app/ReportingApp';
import { edmontonDateKey } from '../lib/report-time';
import { reportingWeekLabel, reportingWeekStart } from '../lib/report-weeks';
import type { ReportRecord } from '../lib/report-types';

vi.mock('next/image', () => ({ default: () => null }));
const makeRecord = (i: number): ReportRecord => ({
  id: String(i), referenceNumber: `CM-CMP-${String(i).padStart(4, '0')}`, recordType: 'complaint',
  occurredAt: `${edmontonDateKey()}T14:30`, reportedAt: `${edmontonDateKey()}T14:30`, registeredCommunity: 'Brooks',
  siteAddress: '', routeNumber: '', serviceType: '', category: 'Service quality', categoryOtherReason: '',
  priority: 'High', status: 'Open', contactMedium: 'Phone call', employeeName: 'Test employee', employeeTitle: 'Dispatcher',
  customerName: '', customerAddress: `${i} Example Avenue`, customerContactInformation: '',
  issueDescription: 'The recycling cart was not collected.', rootCause: '', correctiveAction: '', resolutionDescription: '',
  resolutionDueAt: '', resolvedAt: '', assignedTo: '', createdAt: '', updatedAt: '', blockage: null, photos: [],
});
let observers: Set<() => void>;
const nextPage = () => { for (const callback of [...observers]) callback(); };
beforeEach(() => {
  observers = new Set();
  vi.stubGlobal('IntersectionObserver', class {
    callback: () => void;
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { this.callback = () => callback([{ isIntersecting: true }]); }
    observe() { observers.add(this.callback); }
    disconnect() { observers.delete(this.callback); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('lazy register', () => {
  it.each(['complaint', 'daily'] as const)('starts %s with no filters, opens this week, and loads older weeks only on demand', async (mode) => {
    const current = reportingWeekStart();
    const earlier = new Date(`${current}T12:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - 7);
    const previous = earlier.toISOString().slice(0, 10);
    const fetcher = vi.fn(async (input: string) => {
      const params = new URL(input, 'https://cm.test').searchParams;
      if (params.get('groupBy') === 'week') return Response.json({ weeks: [{ start: current, total: 1 }, { start: previous, total: 1 }], total: 2 });
      return Response.json({ records: [makeRecord(params.get('from') === previous ? 2 : 1)], total: 1, nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RegisterView mode={mode} revision={0} onCreate={vi.fn()} onOpenRecord={vi.fn()} />);
    await screen.findByRole('button', { name: /^CM-CMP-0001/ });
    const filters = screen.getByRole('button', { name: 'Filters' });
    expect(filters.getAttribute('aria-expanded')).toBe('false');
    const initial = new URL(fetcher.mock.calls[0][0], 'https://cm.test').searchParams;
    expect(initial.get('dateMode')).toBe('all');
    for (const key of ['status', 'priority', 'q', 'from', 'to']) expect(initial.has(key)).toBe(false);
    expect(screen.getByText('This week').closest('button')?.getAttribute('aria-expanded')).toBe('true');
    const older = screen.getByText(reportingWeekLabel(previous)).closest('button')!;
    expect(older.getAttribute('aria-expanded')).toBe('false');
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.click(older);
    await screen.findByRole('button', { name: /^CM-CMP-0002/ });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.click(older);
    expect(screen.queryByRole('button', { name: /^CM-CMP-0002/ })).toBeNull();
    fireEvent.click(older);
    expect(screen.getByRole('button', { name: /^CM-CMP-0002/ })).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('loads 50 initially, automatically appends another batch once, and keeps rows on failure for retry', async () => {
    const open = vi.fn();
    let failNext = true;
    const fetcher = vi.fn(async (input: string) => {
      const params = new URL(input, 'https://cm.test').searchParams;
      if (params.get('groupBy') === 'week') return Response.json({ weeks: [{ start: reportingWeekStart(), total: 100 }], total: 100 });
      const cursor = params.get('cursor');
      if (cursor && failNext) { failNext = false; return Response.json({ error: 'Connection interrupted.' }, { status: 503 }); }
      return Response.json({ records: Array.from({ length: 50 }, (_, i) => makeRecord(i + (cursor ? 50 : 0))), total: 100, nextCursor: cursor ? null : 'page-two' });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RegisterView mode="complaint" revision={0} onCreate={vi.fn()} onOpenRecord={open} />);
    expect(screen.getByRole('status').textContent).toContain('Loading report weeks');
    await screen.findByText('Showing 50 of 100');
    expect(screen.getAllByRole('button', { name: /^CM-CMP-/ })).toHaveLength(50);
    expect(screen.getByText('1 Example Avenue')).toBeDefined();
    expect(screen.queryByText('Name not provided')).toBeNull();
    expect(screen.getAllByText('Brooks')).toHaveLength(50);
    act(() => { nextPage(); nextPage(); });
    await screen.findByText('Connection interrupted.');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole('button', { name: /^CM-CMP-/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('All 100 records in this week shown.');
    expect(screen.getAllByRole('button', { name: /^CM-CMP-/ })).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: /^CM-CMP-0051/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: '51' }));
    expect(screen.getByText('100 records across 1 week')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Load 50 more' })).toBeNull();
  });

  it('keeps historical weeks closed until opened or found by search, and preserves the choice on refresh', async () => {
    const previous = '2024-01-01';
    const fetcher = vi.fn(async (input: string) => {
      const params = new URL(input, 'https://cm.test').searchParams;
      if (params.get('groupBy') === 'week') return Response.json({ weeks: [{ start: previous, total: 1 }], total: 1 });
      return Response.json({ records: [makeRecord(7)], total: 1, nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const props = { mode: 'complaint' as const, revision: 0, onCreate: vi.fn(), onOpenRecord: vi.fn() };
    const view = render(<RegisterView {...props} />);
    await screen.findByText('No complaints this week. Open an earlier week below to view its reports.');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const older = screen.getByText(reportingWeekLabel(previous)).closest('button')!;
    expect(older.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(older);
    await screen.findByRole('button', { name: /^CM-CMP-0007/ });
    fireEvent.click(older);
    view.rerender(<RegisterView {...props} revision={1} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(older.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^CM-CMP-0007/ })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search records' }), { target: { value: 'Example' } });
    await screen.findByRole('button', { name: /^CM-CMP-0007/ });
    expect(screen.getByText(reportingWeekLabel(previous)).closest('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('No complaints this week. Open an earlier week below to view its reports.')).toBeNull();
  });

  it('retries a failed week summary before loading records', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Connection interrupted.' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ weeks: [{ start: reportingWeekStart(), total: 1 }], total: 1 }))
      .mockResolvedValueOnce(Response.json({ records: [makeRecord(1)], total: 1, nextCursor: null }));
    vi.stubGlobal('fetch', fetcher);
    render(<RegisterView mode="daily" revision={0} onCreate={vi.fn()} onOpenRecord={vi.fn()} />);
    await screen.findByText('Connection interrupted.');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: /^CM-CMP-0001/ });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserves collapsed filters, starts at the first matching page, and ignores a late response', async () => {
    let resolveOld: (response: Response) => void = () => undefined;
    let oldSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const params = new URL(input, 'https://cm.test').searchParams;
      if (params.get('groupBy') === 'week' && params.get('q') === 'old') {
        oldSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      if (params.get('groupBy') === 'week') return Response.json({ weeks: [{ start: reportingWeekStart(), total: 1 }], total: 1 });
      return Response.json({ records: [makeRecord(params.get('q') ? 999 : 1)], total: 1, nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RegisterView mode="complaint" revision={0} onCreate={vi.fn()} onOpenRecord={vi.fn()} />);
    await screen.findByText('1 Example Avenue');
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Filter options' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Priority' })).toBeNull();
    fireEvent.click(toggle);
    const filterPanel = screen.getByRole('group', { name: 'Filter options' });
    expect(toggle.getAttribute('aria-controls')).toBe(filterPanel.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const search = screen.getByRole('searchbox', { name: 'Search records' });
    fireEvent.change(search, { target: { value: 'old' } });
    expect(screen.queryByText('1 Example Avenue')).toBeNull();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    fireEvent.change(search, { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Open' } });
    await screen.findByText('999 Example Avenue');
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { resolveOld(Response.json({ weeks: [{ start: '2020-01-06', total: 444 }], total: 444 })); });
    expect(screen.queryByText('444 Example Avenue')).toBeNull();
    const params = new URL(fetcher.mock.calls.at(-1)![0], 'https://cm.test').searchParams;
    expect(params.get('q')).toBe('new');
    expect(params.get('priority')).toBe('High');
    expect(params.get('status')).toBe('Open');
    expect(params.has('cursor')).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Filters, 2 active');
    fireEvent.click(toggle);
    expect(screen.queryByRole('group', { name: 'Filter options' })).toBeNull();
    expect(screen.getByText('999 Example Avenue')).toBeDefined();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Priority')).toHaveProperty('value', 'High');
    expect(screen.getByLabelText('Status')).toHaveProperty('value', 'Open');
    fireEvent.click(within(filterPanel).getByRole('button', { name: 'Clear filters' }));
    await screen.findByText('1 Example Avenue');
    expect(search).toHaveProperty('value', '');
    expect(toggle.getAttribute('aria-label')).toBe('Filters');
    expect(within(filterPanel).getByRole('button', { name: 'Clear filters' })).toHaveProperty('disabled', true);
  });

  it('blocks invalid dates, allows today as a single day, and preserves filters when records refresh', async () => {
    const fetcher = vi.fn(async () => Response.json({ weeks: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    const props = { mode: 'complaint' as const, revision: 0, onCreate: vi.fn(), onOpenRecord: vi.fn() };
    const view = render(<RegisterView {...props} />);
    await screen.findByText('No complaints logged');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-04' } });
    expect(screen.getByRole('alert').textContent).toContain('start date must be before');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: 'day' } });
    fireEvent.change(screen.getByLabelText('Report date'), { target: { value: '2099-01-01' } });
    expect(screen.getByRole('alert').textContent).toContain('later than today');
    fireEvent.change(screen.getByLabelText('Report date'), { target: { value: edmontonDateKey() } });
    await screen.findByText('No matching records');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<RegisterView {...props} revision={1} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Report date')).toHaveProperty('value', edmontonDateKey());
  });
});
