// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportEmailActions from '../app/components/ReportEmailActions';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('report test email controls', () => {
  it('shows recipients before sending, uses the selected report and base path, and displays relay acceptance', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
    vi.stubGlobal('fetch', vi.fn(async (_input, options) => options?.method === 'POST'
      ? Response.json({ accepted: ['office@example.invalid'], failed: [] })
      : Response.json({ recipients: ['office@example.invalid'], senders: ['test-sender@example.invalid', 'alternate@example.invalid'], day: '2026-11-10', reportCount: 1, photoCount: 2, sendAt: '17:00', automaticEnabled: false })));
    render(<ReportEmailActions />);
    expect(await screen.findByText('office@example.invalid')).toBeTruthy();
    expect(screen.getByText('Automatic emails off')).toBeTruthy();
    expect(screen.getByText(/Schedule:/)).toHaveProperty('textContent', expect.stringContaining('17:00 Edmonton time'));
    expect(screen.getByRole('link', { name: "Preview today's PDF" }).getAttribute('href')).toBe('/cm-reporting/api/email/blocked-calls/report');
    expect(screen.getByRole('link', { name: "Preview today's Excel" }).getAttribute('href')).toBe('/cm-reporting/api/email/blocked-calls/report?format=xlsx');
    expect(fetch).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send test email' }));
    expect(fetch).toHaveBeenLastCalledWith('/cm-reporting/api/email/blocked-calls', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'test-sender@example.invalid' }) });
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('relay accepted'));
    expect(screen.getByRole('button', { name: 'Test completed' })).toHaveProperty('disabled', true);
    await userEvent.setup().selectOptions(screen.getByLabelText('Test sender'), 'alternate@example.invalid');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send test email' }));
    expect(fetch).toHaveBeenLastCalledWith('/cm-reporting/api/email/blocked-calls', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'alternate@example.invalid' }) });
  });

  it('sends edited recipients and restores the environment fallback when cleared', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, options) => options?.method === 'POST'
      ? Response.json({ accepted: [JSON.parse(options.body).to || 'office@example.invalid'], failed: [] })
      : Response.json({ recipients: ['office@example.invalid'], senders: ['test-sender@example.invalid'], day: '2026-11-10', reportCount: 318, photoCount: 318, sendAt: '17:00', automaticEnabled: false })));
    const user = userEvent.setup();
    render(<ReportEmailActions />);
    const to = await screen.findByLabelText(/Send to/);
    expect(to).toHaveProperty('value', '');
    expect(to.getAttribute('placeholder')).toBe('office@example.invalid');
    await user.type(to, 'edited@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(fetch).toHaveBeenLastCalledWith('/api/email/blocked-calls', expect.objectContaining({
      body: JSON.stringify({ from: 'test-sender@example.invalid', to: 'edited@example.invalid' }),
    }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('edited@example.invalid'));
    await user.clear(to);
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(fetch).toHaveBeenLastCalledWith('/api/email/blocked-calls', expect.objectContaining({
      body: JSON.stringify({ from: 'test-sender@example.invalid' }),
    }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('office@example.invalid'));
  });

  it('keeps the edited recipient available to correct after a server validation error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, options) => options?.method === 'POST'
      ? Response.json({ error: 'Enter valid email addresses separated by commas or semicolons.' }, { status: 400 })
      : Response.json({ recipients: ['office@example.invalid'], senders: ['test-sender@example.invalid'], day: '2026-11-10', reportCount: 1, photoCount: 2, sendAt: '17:00', automaticEnabled: false })));
    const user = userEvent.setup();
    render(<ReportEmailActions />);
    const to = await screen.findByLabelText(/Send to/);
    await user.type(to, 'incorrect');
    await user.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('valid email addresses'));
    expect(to).toHaveProperty('value', 'incorrect');
    expect(screen.getByRole('button', { name: 'Send test email' })).toHaveProperty('disabled', false);
  });

  it('shows failed recipients and never claims inbox delivery', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, options) => options?.method === 'POST'
      ? Response.json({ accepted: [], failed: [{ recipient: 'office@example.invalid', code: 'ETIMEDOUT' }] })
      : Response.json({ recipients: ['office@example.invalid'], senders: ['test-sender@example.invalid', 'alternate@example.invalid'], day: '2026-11-10', reportCount: 1, photoCount: 2, sendAt: '17:00', automaticEnabled: true })));
    render(<ReportEmailActions />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send test email' })).toHaveProperty('disabled', false));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('ETIMEDOUT'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
