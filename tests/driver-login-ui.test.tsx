// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DriverLogin from '../app/blocked-call/login/page';
import SessionNotice from '../app/components/SessionNotice';
import { reportingFetch } from '../lib/reporting-fetch';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`Redirect: ${path}`); } }));
const state = vi.hoisted(() => ({ authenticated: false }));
vi.mock('../lib/request-access', () => ({ signedInDriver: () => state.authenticated ? { kind: 'driver', name: 'Driver' } : null }));
vi.mock('next/image', () => ({ default: () => null }));

beforeEach(() => {
  state.authenticated = false;
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_PUBLIC_ORIGIN', 'https://cm.test');
  vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', 'test-only-driver-password');
  vi.stubEnv('CM_ENTRA_CLIENT_SECRET', '');
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('shows an independent password form without exposing the configured password', async () => {
  render(await DriverLogin({ searchParams: Promise.resolve({ error: 'signin', returnTo: 'https://untrusted.invalid' }) }));
  expect(screen.getByRole('heading', { name: 'Driver sign-in' })).toBeTruthy();
  expect(screen.getByLabelText('Driver password').getAttribute('type')).toBe('password');
  const form = screen.getByRole('button', { name: 'Open blocked-call form' }).closest('form')!;
  expect(form.getAttribute('method')).toBe('post');
  expect(form.getAttribute('action')).toBe('/cm-reporting/api/auth/driver');
  expect(screen.queryByRole('link', { name: 'Sign in with Microsoft' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('password was not accepted');
  expect(document.body.innerHTML).not.toContain(process.env.CM_DRIVER_LOGIN_PASSWORD);
  expect(document.body.innerHTML).not.toContain('untrusted.invalid');
});

it('uses an absolute destination to avoid adding the application base path twice after sign-in', async () => {
  state.authenticated = true;
  await expect(DriverLogin({ searchParams: Promise.resolve({}) })).rejects.toThrow('Redirect: https://cm.test/cm-reporting/blocked-call');
});

it('hides the form when driver access is disabled', async () => {
  vi.stubEnv('CM_DRIVER_LOGIN_PASSWORD', '');
  render(await DriverLogin({ searchParams: Promise.resolve({ error: '__proto__' }) }));
  expect(screen.queryByLabelText('Driver password')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('not available');
  expect(document.body.textContent).not.toContain('__proto__');
});

it('reauthenticates drivers with the password in a separate tab while retaining their draft', async () => {
  window.history.replaceState({}, '', '/cm-reporting/blocked-call');
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<><input aria-label="Unsaved driver report" defaultValue="Driver draft" /><SessionNotice /></>);
  await act(async () => { await reportingFetch('/cm-reporting/api/blocked-call', { method: 'POST' }); });
  const link = screen.getByRole('link', { name: 'Sign in again (new tab)' });
  expect(link.getAttribute('href')).toBe('/cm-reporting/blocked-call/login');
  expect(link.getAttribute('target')).toBe('_blank');
  fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' }));
  await screen.findByText('Please finish signing in, then check again.');
  fetchMock.mockResolvedValue(Response.json({ user: { kind: 'driver', name: 'Driver' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(fetchMock).toHaveBeenLastCalledWith('/cm-reporting/api/auth/driver/session', { cache: 'no-store' });
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Driver draft');
});
