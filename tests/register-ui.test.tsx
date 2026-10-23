// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterView } from '../app/ReportingApp';
import { edmontonDateKey } from '../lib/report-time';
import type { ReportRecord } from '../lib/report-types';

vi.mock('next/image', () => ({ default: () => null }));
const makeRecord = (i: number): ReportRecord => ({
  id: String(i), referenceNumber: `CM-CMP-${String(i).padStart(4, '0')}`, recordType: 'complaint',
  occurredAt: '2026-10-04T14:30', reportedAt: '2026-10-04T14:30', registeredCommunity: 'Brooks',
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
  it('loads 50 initially, automatically appends another batch once, and keeps rows on failure for retry', async () => {
    const open = vi.fn();
    let failNext = true;
    const fetcher = vi.fn(async (input: string) => {
      const cursor = new URL(input, 'https://cm.test').searchParams.get('cursor');
      if (cursor && failNext) { failNext = false; return Response.json({ error: 'Connection interrupted.' }, { status: 503 }); }
      return Response.json({ records: Array.from({ length: 50 }, (_, i) => makeRecord(i + (cursor ? 50 : 0))), total: 100, nextCursor: cursor ? null : 'page-two' });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RegisterView mode="complaint" revision={0} onCreate={vi.fn()} onOpenRecord={open} />);
    expect(screen.getByRole('status').textContent).toContain('Loading records');
    await screen.findByText('Showing 50 of 100 records');
    expect(screen.getAllByRole('button', { name: /^CM-CMP-/ })).toHaveLength(50);
    expect(screen.getByText('1 Example Avenue')).toBeDefined();
    expect(screen.getAllByText('Name not provided')).toHaveLength(50);
    act(() => { nextPage(); nextPage(); });
    await screen.findByText('Connection interrupted.');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('button', { name: /^CM-CMP-/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Showing 100 of 100 records');
    expect(screen.getAllByRole('button', { name: /^CM-CMP-/ })).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: /^CM-CMP-0051/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: '51' }));
    expect(screen.getByText('All matching records are shown.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Load 50 more' })).toBeNull();
  });

  it('starts over at the first matching page for search and filters and ignores a late response', async () => {
    let resolveOld: (response: Response) => void = () => undefined;
    let oldSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const params = new URL(input, 'https://cm.test').searchParams;
      if (params.get('q') === 'old') {
        oldSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      return Response.json({ records: [makeRecord(params.get('q') ? 999 : 1)], total: 1, nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RegisterView mode="complaint" revision={0} onCreate={vi.fn()} onOpenRecord={vi.fn()} />);
    await screen.findByText('1 Example Avenue');
    const search = screen.getByRole('searchbox', { name: 'Search records' });
    fireEvent.change(search, { target: { value: 'old' } });
    expect(screen.queryByText('1 Example Avenue')).toBeNull();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    fireEvent.change(search, { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Open' } });
    await screen.findByText('999 Example Avenue');
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { resolveOld(Response.json({ records: [makeRecord(444)], total: 1, nextCursor: null })); });
    expect(screen.queryByText('444 Example Avenue')).toBeNull();
    const params = new URL(fetcher.mock.calls.at(-1)![0], 'https://cm.test').searchParams;
    expect(params.get('q')).toBe('new');
    expect(params.get('priority')).toBe('High');
    expect(params.get('status')).toBe('Open');
    expect(params.has('cursor')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByText('1 Example Avenue');
    expect(search).toHaveProperty('value', '');
  });

  it('blocks invalid dates, allows today as a single day, and preserves filters when records refresh', async () => {
    const fetcher = vi.fn(async () => Response.json({ records: [], total: 0, nextCursor: null }));
    vi.stubGlobal('fetch', fetcher);
    const props = { mode: 'complaint' as const, revision: 0, onCreate: vi.fn(), onOpenRecord: vi.fn() };
    const view = render(<RegisterView {...props} />);
    await screen.findByText('No complaints logged');
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
