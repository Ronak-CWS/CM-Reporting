// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BlockedCallPage from '../app/blocked-call/page';

const state = vi.hoisted(() => ({ denied: false, push: vi.fn(), author: vi.fn(() => 'Signed-in Driver') }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), redirect: (path: string) => { throw new Error(`Redirect: ${path}`); } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../lib/request-access', () => ({ accessFailure: () => state.denied ? { status: 401 } : null, reportAuthorName: state.author }));

beforeEach(() => {
  state.denied = false;
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('opens the driver form directly with the server identity and returns to reporting on close', async () => {
  const page = await BlockedCallPage();
  expect(page.props.reporterName).toBe('Signed-in Driver');
  render(page);
  expect(screen.getByRole('heading', { name: 'What is blocked?' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Complaint reporting' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(state.push).toHaveBeenCalledWith('/cm-reporting/');
});

it('requires sign-in and retains the requested driver page', async () => {
  state.denied = true;
  await expect(BlockedCallPage()).rejects.toThrow('Redirect: /cm-reporting/login?returnTo=%2Fblocked-call');
  expect(state.author).not.toHaveBeenCalled();
});
