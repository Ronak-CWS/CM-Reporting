// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportEmailActions from '../app/components/ReportEmailActions';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function setup({ enabled = false, fail = false, partial = false } = {}) {
  let automatic = { enabled, to: ['automatic@example.invalid'], cc: [], formats: ['pdf'] };
  const fetch = vi.fn(async (input: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body || '{}'));
    if (options?.method === 'PATCH') {
      automatic = { enabled: body.enabled, to: body.to === undefined ? automatic.to : body.to.split(','), cc: body.cc ? body.cc.split(',') : [], formats: body.formats || automatic.formats };
      return Response.json({ automatic });
    }
    if (options?.method === 'POST') return fail
      ? Response.json({ error: 'Enter valid email addresses.' }, { status: 400 })
      : Response.json({ accepted: partial ? [] : [body.to || 'office@example.invalid'], failed: partial ? [{ recipient: 'office@example.invalid', code: 'ETIMEDOUT' }] : [] });
    return Response.json({ recipients: ['office@example.invalid'], cc: [], senders: ['test-sender@example.invalid', 'alternate@example.invalid'],
      day: new URL(input, 'https://cm.test').searchParams.get('day') || '2026-11-10', today: '2026-11-10', reportCount: 3, photoCount: 3, sendAt: '17:00', automatic });
  });
  vi.stubGlobal('fetch', fetch);
  render(<ReportEmailActions />);
  return { fetch, user: userEvent.setup() };
}

describe('manual and automatic report email controls', () => {
  it('uses the selected date for previews and sends both files with edited To and CC in one request', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
    const { fetch, user } = setup();
    const date = await screen.findByLabelText('Report date');
    fireEvent.change(date, { target: { value: '2026-11-09' } });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Preview PDF' }).getAttribute('href')).toBe('/cm-reporting/api/email/blocked-calls/report?day=2026-11-09&format=pdf'));
    expect(screen.getByRole('link', { name: 'Preview Excel' }).getAttribute('href')).toBe('/cm-reporting/api/email/blocked-calls/report?day=2026-11-09&format=xlsx');
    await user.type(screen.getByLabelText('To'), 'one@example.invalid,two@example.invalid');
    await user.type(screen.getByLabelText('CC (optional)'), 'copy@example.invalid');
    await user.selectOptions(screen.getByLabelText('From'), 'alternate@example.invalid');
    await user.click(within(screen.getByRole('group', { name: 'Manual attachments' })).getByLabelText('Excel'));
    await user.click(screen.getByRole('button', { name: 'Send email manually' }));
    expect(fetch).toHaveBeenLastCalledWith('/cm-reporting/api/email/blocked-calls', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'alternate@example.invalid', day: '2026-11-09', formats: ['pdf', 'xlsx'], cc: 'copy@example.invalid', to: 'one@example.invalid,two@example.invalid' }) });
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('relay accepted'));
    expect(screen.getByRole('switch')).toHaveProperty('ariaChecked', 'false');
    expect(screen.getByRole('button', { name: 'Email submitted' })).toHaveProperty('disabled', true);
  });

  it('uses environment To when blank and requires at least one attachment and a date', async () => {
    const { fetch, user } = setup();
    const date = await screen.findByLabelText('Report date');
    expect(screen.getByLabelText('To').getAttribute('placeholder')).toBe('office@example.invalid');
    const pdf = within(screen.getByRole('group', { name: 'Manual attachments' })).getByLabelText('PDF');
    await user.click(pdf);
    expect(screen.getByRole('button', { name: 'Send email manually' })).toHaveProperty('disabled', true);
    await user.click(pdf);
    fireEvent.change(date, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Send email manually' })).toHaveProperty('disabled', true);
    fireEvent.change(date, { target: { value: '2026-11-10' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send email manually' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Send email manually' }));
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ from: 'test-sender@example.invalid', day: '2026-11-10', formats: ['pdf'], cc: '' });
  });

  it('saves automatic CC and formats without sending email or changing the manual date', async () => {
    const { fetch, user } = setup();
    await screen.findByLabelText('Report date');
    await user.type(screen.getByLabelText('Automatic CC (optional)'), 'copy@example.invalid');
    await user.click(within(screen.getByRole('group', { name: 'Automatic attachments' })).getByLabelText('Excel'));
    await user.click(screen.getByRole('button', { name: 'Save automatic settings' }));
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ enabled: false, to: 'automatic@example.invalid', cc: 'copy@example.invalid', formats: ['pdf', 'xlsx'] });
    await user.click(screen.getByRole('switch', { name: 'Automatic daily email' }));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByLabelText('Report date')).toHaveProperty('value', '2026-11-10');
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(screen.getByText(/Every day at 17:00 Edmonton/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Automatic To'));
    await user.type(screen.getByLabelText('Automatic To'), 'unfinished');
    await user.click(screen.getByRole('switch'));
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ enabled: false });
  });

  it('retains edits when the server rejects recipients', async () => {
    const { user } = setup({ fail: true });
    await user.type(await screen.findByLabelText('To'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Send email manually' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('valid email addresses'));
    expect(screen.getByLabelText('To')).toHaveProperty('value', 'invalid');
    expect(screen.getByRole('button', { name: 'Send email manually' })).toHaveProperty('disabled', false);
  });

  it('reports delivery failures without claiming inbox delivery', async () => {
    const { user } = setup({ partial: true });
    await screen.findByLabelText('Report date');
    await user.click(screen.getByRole('button', { name: 'Send email manually' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('ETIMEDOUT'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
