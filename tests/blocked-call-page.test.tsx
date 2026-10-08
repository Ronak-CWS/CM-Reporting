// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockedCallPage from '../app/blocked-call/page';
import { createLocationCatalogue, type LocationKind } from '../lib/location-catalogue';
import locations from './fixtures/service-locations.json';

const state = vi.hoisted(() => ({ denied: false, destination: '', push: vi.fn(), author: vi.fn(() => 'Signed-in Driver') }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), redirect: (path: string) => { throw new Error(`Redirect: ${path}`); } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../lib/request-access', () => ({ accessFailure: () => state.denied ? { status: 401 } : null, reportAuthorName: state.author }));
const require = createRequire(import.meta.url);
const routingHelper = require.resolve('next/dist/client/add-base-path');
const catalogue = createLocationCatalogue(locations);

beforeEach(() => {
  state.denied = false;
  state.destination = '';
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('__NEXT_ROUTER_BASEPATH', '/cm-reporting');
  vi.stubEnv('__NEXT_MANUAL_CLIENT_BASE_PATH', '');
  vi.stubEnv('__NEXT_TRAILING_SLASH', '');
  delete require.cache[routingHelper];
  // Apply Next's actual client routing helper, not just a mock expecting a URL.
  const { addBasePath } = require(routingHelper) as { addBasePath: (href: string) => string };
  state.push.mockImplementation((href: string) => { state.destination = addBasePath(href); });
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'https://cm.test');
    return Response.json(catalogue.search(url.searchParams.get('kind') as LocationKind, url.searchParams.get('q') || '', url.searchParams.get('community') || ''));
  }));
  URL.createObjectURL = vi.fn(() => 'blob:photo-test');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); delete require.cache[routingHelper]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('opens the driver form directly with the server identity and returns to reporting on close', async () => {
  const page = await BlockedCallPage();
  expect(page.props.reporterName).toBe('Signed-in Driver');
  render(page);
  expect(screen.getByRole('heading', { name: 'What is blocked?' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Complaint reporting' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(state.destination).toBe('/cm-reporting');
});

it('returns from the final step to the dashboard after confirming discard', async () => {
  render(await BlockedCallPage());
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /A street \/ street block/ }));
  await user.type(screen.getByLabelText('Community'), 'Test community');
  await user.click(await screen.findByRole('option', { name: 'Test community' }));
  await user.type(screen.getByLabelText('Street name'), 'Test Street');
  await user.click(await screen.findByRole('option', { name: 'Test Street' }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.click(screen.getByRole('button', { name: /Flooded street/ }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'street.jpg', { type: 'image/jpeg' }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  expect(screen.getByRole('heading', { name: 'Ready to submit?' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(state.push).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Keep reporting' }));
  expect(screen.getByRole('heading', { name: 'Ready to submit?' })).toBeTruthy();
  expect(screen.getByText('1 attached')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Discard and close' }));
  expect(state.push).toHaveBeenCalledTimes(1);
  expect(state.destination).toBe('/cm-reporting');
});

it('requires sign-in and retains the requested driver page', async () => {
  state.denied = true;
  await expect(BlockedCallPage()).rejects.toThrow('Redirect: /cm-reporting/login?returnTo=%2Fblocked-call');
  expect(state.author).not.toHaveBeenCalled();
});
