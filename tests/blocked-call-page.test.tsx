// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockedCallPage from '../app/blocked-call/page';
import { createLocationCatalogue, type LocationKind } from '../lib/location-catalogue';
import locations from './fixtures/service-locations.json';

const state = vi.hoisted(() => ({ denied: false, destination: '', replace: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }), redirect: (path: string) => { throw new Error(`Redirect: ${path}`); } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../lib/request-access', () => ({ driverAccessFailure: () => state.denied ? { status: 401 } : null }));
const require = createRequire(import.meta.url);
const routingHelper = require.resolve('next/dist/client/add-base-path');
const catalogue = createLocationCatalogue(locations);

beforeEach(() => {
  state.denied = false;
  state.destination = '';
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/cm-reporting');
  vi.stubEnv('CM_PUBLIC_ORIGIN', 'https://cm.test');
  vi.stubEnv('__NEXT_ROUTER_BASEPATH', '/cm-reporting');
  vi.stubEnv('__NEXT_MANUAL_CLIENT_BASE_PATH', '');
  vi.stubEnv('__NEXT_TRAILING_SLASH', '');
  delete require.cache[routingHelper];
  // Apply Next's actual client routing helper, not just a mock expecting a URL.
  const { addBasePath } = require(routingHelper) as { addBasePath: (href: string) => string };
  state.replace.mockImplementation((href: string) => { state.destination = addBasePath(href); });
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.endsWith('/api/auth/driver/logout')) return new Response(null, { status: 200 });
    const url = new URL(input, 'https://cm.test');
    return Response.json(catalogue.search(url.searchParams.get('kind') as LocationKind, url.searchParams.get('q') || '', url.searchParams.get('community') || ''));
  }));
  URL.createObjectURL = vi.fn(() => 'blob:photo-test');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); delete require.cache[routingHelper]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('opens the standalone form and signs out to the driver login under the correct base path', async () => {
  const page = await BlockedCallPage();
  render(page);
  expect(screen.getByRole('heading', { name: 'What is blocked?' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Complaint reporting' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(state.destination).toBe('/cm-reporting/blocked-call/login?loggedOut=1'));
  expect(fetch).toHaveBeenCalledWith('/cm-reporting/api/auth/driver/logout', { method: 'POST' });
});

it('signs out from the final step only after confirming discard', async () => {
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

  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(state.replace).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Keep reporting' }));
  expect(screen.getByRole('heading', { name: 'Ready to submit?' })).toBeTruthy();
  expect(screen.getByText('1 attached')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await user.click(screen.getByRole('button', { name: 'Discard and sign out' }));
  await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1));
  expect(state.destination).toBe('/cm-reporting/blocked-call/login?loggedOut=1');
});

it('requires the driver password login', async () => {
  state.denied = true;
  await expect(BlockedCallPage()).rejects.toThrow('Redirect: https://cm.test/cm-reporting/blocked-call/login');
});

it('keeps the form open when sign-out fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  render(await BlockedCallPage());
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not sign out. Please try again.');
  expect(state.replace).not.toHaveBeenCalled();
});
