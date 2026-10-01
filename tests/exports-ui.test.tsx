// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportingApp from '../app/ReportingApp';

vi.mock('next/image', () => ({ default: () => null }));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ records: [] }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('export date controls', () => {
  it.each(['Operational activity export', 'Complaint record export'])('blocks invalid ranges and re-enables a corrected %s', async (title) => {
    render(<ReportingApp />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Exports' }));
    const card = within(screen.getByRole('heading', { name: title }).closest('article')!);
    const from = card.getByLabelText('From');
    const to = card.getByLabelText('To');
    fireEvent.change(from, { target: { value: '2026-09-24' } });
    fireEvent.change(to, { target: { value: '2026-09-21' } });
    expect(card.getByRole('alert').textContent).toContain('end date must be on or after');
    expect(card.getByRole('button', { name: 'Download CSV' })).toHaveProperty('disabled', true);
    expect(card.queryByRole('link', { name: 'Download CSV' })).toBeNull();
    expect(to.getAttribute('min')).toBe('2026-09-24');
    expect(from.getAttribute('max')).toBe('2026-09-21');

    fireEvent.change(to, { target: { value: '2026-09-24' } });
    expect(card.queryByRole('alert')).toBeNull();
    expect(card.getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toContain('from=2026-09-24&to=2026-09-24');
    fireEvent.change(from, { target: { value: '' } });
    expect(card.getByRole('alert').textContent).toContain('Choose both');
    expect(card.getByRole('button', { name: 'Download CSV' })).toHaveProperty('disabled', true);
  });
});
