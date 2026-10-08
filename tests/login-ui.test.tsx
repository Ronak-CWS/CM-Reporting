// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../app/login/page';
import SessionNotice from '../app/components/SessionNotice';
import { reportingFetch } from '../lib/reporting-fetch';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../lib/request-access', () => ({ signedInUser: () => null }));
vi.mock('next/image', () => ({ default: (props: { src: string; alt: string }) => <span role="img" aria-label={props.alt} data-src={props.src} /> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.stubEnv('CM_AUTH_MODE', 'microsoft');
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_PUBLIC_ORIGIN', 'https://cm.test');
  vi.stubEnv('CM_ENTRA_TENANT_ID', '11111111-2222-3333-4444-555555555555');
  vi.stubEnv('CM_ENTRA_CLIENT_ID', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  vi.stubEnv('CM_ENTRA_CLIENT_SECRET', 'test-only-secret-never-a-real-credential');
});

describe('Microsoft sign-in screen', () => {
  it('keeps sign-in and branding under the deployed application path', async () => {
    render(await Login({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: 'Sign in with Microsoft' }).getAttribute('href')).toBe('/cm-reporting/api/auth/microsoft/start');
    expect(screen.getByRole('img').getAttribute('data-src')).toBe('/cm-reporting/collective-waste-solutions.png');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guest login' })).toBeNull();
  });
  it('explains missing setup without exposing credentials or reflecting arbitrary errors', async () => {
    vi.stubEnv('CM_ENTRA_CLIENT_SECRET', '');
    render(await Login({ searchParams: Promise.resolve({ error: '__proto__' }) }));
    expect(screen.getByRole('status').textContent).toContain('being set up');
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.body.textContent).not.toContain('__proto__');
  });
  it('shows an access error and a retry link', async () => {
    render(await Login({ searchParams: Promise.resolve({ error: 'access' }) }));
    expect(screen.getByRole('alert').textContent).toContain('does not have access');
    expect(screen.getByRole('link', { name: 'Sign in with Microsoft' })).toBeDefined();
  });
  it('preserves the driver destination for both login options', async () => {
    vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'true');
    vi.stubEnv('CM_GUEST_LOGIN_PASSWORD', 'unit-test-password-not-a-real-secret');
    vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', new Date(Date.now() + 3600_000).toISOString());
    render(await Login({ searchParams: Promise.resolve({ returnTo: '/blocked-call' }) }));
    expect(screen.getByRole('link', { name: 'Sign in with Microsoft' }).getAttribute('href')).toBe('/cm-reporting/api/auth/microsoft/start?returnTo=%2Fblocked-call');
    expect(screen.getByRole('button', { name: 'Guest login' }).closest('form')?.getAttribute('action')).toBe('/cm-reporting/api/auth/guest?returnTo=%2Fblocked-call');
  });
  it('shows a password-protected guest form only during an active testing window', async () => {
    vi.stubEnv('CM_GUEST_LOGIN_ENABLED', 'true');
    vi.stubEnv('CM_GUEST_LOGIN_PASSWORD', 'unit-test-password-not-a-real-secret');
    vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', new Date(Date.now() + 3600_000).toISOString());
    render(await Login({ searchParams: Promise.resolve({ error: 'guest-signin' }) }));
    const input = screen.getByLabelText('Guest password');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.hasAttribute('required')).toBe(true);
    const form = screen.getByRole('button', { name: 'Guest login' }).closest('form')!;
    expect(form.getAttribute('action')).toBe('/cm-reporting/api/auth/guest');
    expect(form.getAttribute('method')).toBe('post');
    expect(screen.getByRole('alert').textContent).toContain('password was not accepted');
    expect(document.body.innerHTML).not.toContain(process.env.CM_GUEST_LOGIN_PASSWORD);
    expect(screen.getByRole('link', { name: 'Sign in with Microsoft' })).toBeDefined();
    cleanup();
    vi.stubEnv('CM_GUEST_LOGIN_EXPIRES_AT', '2020-01-01T00:00:00Z');
    render(await Login({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('button', { name: 'Guest login' })).toBeNull();
  });
});

it('preserves an unsaved form on expiry and verifies reauthentication before hiding the notice', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<><input aria-label="Unsaved report" defaultValue="Driver draft" /><SessionNotice /></>);
  await act(async () => { await reportingFetch('/cm-reporting/api/records', { method: 'POST' }); });
  const link = screen.getByRole('link', { name: 'Sign in again (new tab)' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('href')).toBe('/cm-reporting/login');
  fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' }));
  await screen.findByText('Please finish signing in, then check again.');
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Driver draft');
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(fetchMock).toHaveBeenLastCalledWith('/cm-reporting/api/auth/session', { cache: 'no-store' });
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Driver draft');
});
