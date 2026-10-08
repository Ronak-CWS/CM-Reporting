// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockedCallWizard from '../app/components/BlockedCallWizard';
import { createLocationCatalogue } from '../lib/location-catalogue';
import locations from './fixtures/service-locations.json';
import { SESSION_RESTORED_EVENT } from '../lib/reporting-fetch';

vi.mock('next/image', () => ({ default: () => null }));
const catalogue = createLocationCatalogue(locations);
function locationResponse(url: string) {
  const params = new URL(url, 'https://cm.test').searchParams;
  return { ok: true, json: async () => catalogue.search(params.get('kind') as 'community' | 'street' | 'address', params.get('q') || '', params.get('community') || '') };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => locationResponse(url)));
  URL.createObjectURL = vi.fn(() => 'blob:photo-test');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function reachPhotos(scope: 'pickup' | 'street' = 'pickup') {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: scope === 'pickup' ? /A pickup location/ : /A street \/ street block/ }));
  await user.type(screen.getByLabelText('Community'), 'Test community');
  await user.click(await screen.findByRole('option', { name: 'Test community' }));
  const address = scope === 'pickup' ? '123 Test Street' : 'Test Street';
  await user.type(screen.getByLabelText(scope === 'pickup' ? 'Pickup address or site' : 'Street name'), address);
  await user.click(await screen.findByRole('option', { name: address }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.click(screen.getByRole('button', { name: scope === 'pickup' ? /Blocked by a vehicle/ : /Flooded street/ }));
  if (scope === 'pickup') await user.type(screen.getByLabelText('Vehicle plate 1 (required)'), 'ABC123');
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  return user;
}

describe('simple driver flow', () => {
  it('keeps notes, route and photos when editing an earlier step and uses the signed-in name and fixed Recycling service', async () => {
    window.localStorage.setItem('cm-reporting-driver-name', 'Previous device user');
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} />);
    const user = await reachPhotos('street');
    await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'street.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    const name = screen.getByLabelText(/Your name/);
    expect(name).toHaveProperty('value', 'Test Driver');
    expect(name).toHaveProperty('readOnly', true);
    await user.type(name, 'Someone else');
    expect(name).toHaveProperty('value', 'Test Driver');
    expect(screen.getByLabelText('Service').closest('details')).toBeNull();
    expect(screen.getByLabelText('Service')).toHaveProperty('value', 'Recycling');
    expect(screen.getByLabelText('Service')).toHaveProperty('readOnly', true);
    await user.type(screen.getByLabelText('Service'), 'Waste');
    expect(screen.getByLabelText('Service')).toHaveProperty('value', 'Recycling');
    await user.click(screen.getByText('Add a note or route'));
    await user.type(screen.getByLabelText('Anything else?'), 'Office notified');
    await user.type(screen.getByLabelText('Route number'), 'R12');
    await user.click(screen.getByRole('button', { name: 'Go to location step' }));
    expect(screen.getByLabelText('Street name')).toHaveProperty('value', 'Test Street');
    await user.click(screen.getByRole('button', { name: 'Return to review' }));
    expect(screen.getByText('1 attached')).toBeTruthy();
    expect(screen.getByLabelText('Service')).toHaveProperty('value', 'Recycling');
    expect(screen.getByLabelText('Anything else?')).toHaveProperty('value', 'Office notified');
    expect(screen.getByLabelText('Route number')).toHaveProperty('value', 'R12');
    act(() => window.dispatchEvent(new CustomEvent(SESSION_RESTORED_EVENT, { detail: 'Reauthenticated Driver' })));
    expect(screen.getByLabelText(/Your name/)).toHaveProperty('value', 'Reauthenticated Driver');
    await user.click(screen.getByRole('button', { name: 'Edit photos' }));
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    await user.click(screen.getByRole('button', { name: 'Go to review step' }));
    expect(screen.getByRole('heading', { name: 'Add a photo' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('photo');
  });

  it('revalidates changed blockage types before returning to review without losing photos', async () => {
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Go to review step' })).toHaveProperty('disabled', true);
    const user = await reachPhotos();
    await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'blockage.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: 'Edit blockage type' }));
    await user.click(screen.getByRole('button', { name: /A street \/ street block/ }));
    await user.click(screen.getByRole('button', { name: 'Go to review step' }));
    expect(screen.getByRole('alert').textContent).toContain('Choose a street');
    await user.type(screen.getByLabelText('Street name'), 'Test Street');
    await user.click(await screen.findByRole('option', { name: 'Test Street' }));
    await user.click(screen.getByRole('button', { name: 'Return to review' }));
    expect(screen.getByRole('heading', { name: 'What is blocking access?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Flooded street/ }));
    await user.click(screen.getByRole('button', { name: 'Return to review' }));
    expect(screen.getByRole('heading', { name: 'Ready to submit?' })).toBeTruthy();
    expect(screen.getByText('1 attached')).toBeTruthy();
    expect(screen.getByText('Flooded street')).toBeTruthy();
    expect(screen.queryByText('Plates: ABC123')).toBeNull();
  });

  it('opens the native camera from the entire empty photo area and attaches its photo', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android');
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} onSaved={vi.fn()} />);
    const user = await reachPhotos('street');
    const input = screen.getByLabelText('Take a blockage photo', { selector: 'input' });
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    await user.upload(input, new File(['test-image'], 'camera.jpg', { type: 'image/jpeg' }));
    expect(screen.getByText('1 photo added')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open camera' })).toBeNull();
  });
  it('shows one task at a time and preserves location on Back', async () => {
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'What is blocked?' })).toBeTruthy();
    expect(screen.queryByLabelText('Community')).toBeNull();
    const user = await reachPhotos();
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('Blocked by a vehicle')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect((screen.getByLabelText('Pickup address or site') as HTMLInputElement).value).toBe('123 Test Street');
    expect(screen.queryByLabelText('Status')).toBeNull();
  });

  it('requires and removes photos for a street report', async () => {
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} onSaved={vi.fn()} />);
    const user = await reachPhotos('street');
    expect((screen.getByLabelText('Take a blockage photo', { selector: 'input' }) as HTMLInputElement).getAttribute('capture')).toBe('environment');
    await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'street.jpg', { type: 'image/jpeg' }));
    expect(screen.getByText('1 photo added')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('retains photos and reuses the submission ID on retry', async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({
      ok: true, json: async () => ({ record: { id: 'saved', referenceNumber: 'CM-DAY-TEST', siteAddress: '123 Test Street', registeredCommunity: 'Test community', photos: [{ id: 'photo' }] } }),
    });
    vi.stubGlobal('fetch', (url: string, options: unknown) => url.startsWith('/api/locations') ? Promise.resolve(locationResponse(url)) : fetchMock(url, options));
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} onSaved={onSaved} />);
    const user = await reachPhotos('street');
    await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'street.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByLabelText(/Your name/)).toHaveProperty('value', 'Test Driver');
    expect(screen.getByLabelText(/Your name/)).toHaveProperty('readOnly', true);
    await user.click(screen.getByRole('button', { name: 'Submit blocked call' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('entries and photos are still here'));
    expect(screen.getByText('1 attached')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Submit blocked call' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const first = fetchMock.mock.calls[0][1].body as FormData;
    const retry = fetchMock.mock.calls[1][1].body as FormData;
    expect(first.get('submissionId')).toBe(retry.get('submissionId'));
    expect(retry.getAll('photos')).toHaveLength(1);
    expect(JSON.parse(String(retry.get('report')))).toMatchObject({ category: 'Blocked call', scope: 'street', reasonCode: 'flooding' });
    expect(screen.getByRole('heading', { name: "You're all set." })).toBeTruthy();
  });

  it('asks before discarding an unsubmitted report', async () => {
    const onClose = vi.fn();
    render(<BlockedCallWizard reporterName="Test Driver" onClose={onClose} onSaved={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /A pickup location/ }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires a selected location and clears the address when the community changes', async () => {
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} onSaved={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /A pickup location/ }));
    await user.type(screen.getByLabelText('Community'), 'Test community');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toContain('Choose a community');
    await user.click(screen.getByLabelText('Community'));
    await user.click(await screen.findByRole('option', { name: 'Test community' }));
    await user.type(screen.getByLabelText('Pickup address or site'), '123 Test Street');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toContain('Choose a pickup address');
    await user.click(screen.getByLabelText('Pickup address or site'));
    await user.click(await screen.findByRole('option', { name: '123 Test Street' }));
    await user.clear(screen.getByLabelText('Community'));
    expect(screen.getByLabelText('Pickup address or site')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Pickup address or site')).toHaveProperty('disabled', true);
  });

  it('requires two different plates for multiple vehicles and keeps additional plates on review', async () => {
    render(<BlockedCallWizard reporterName="Test Driver" onClose={vi.fn()} onSaved={vi.fn()} />);
    const user = await reachPhotos();
    await user.click(screen.getByRole('button', { name: /Back/ }));
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: /Blocked by multiple vehicles/ }));
    const plate2 = screen.getByLabelText('Vehicle plate 2 (required)');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'What is blocking access?' })).toBeTruthy();
    await user.type(plate2, 'abc-123');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toContain('different plate');
    await user.clear(plate2);
    await user.type(plate2, 'XYZ789');
    await user.click(screen.getByRole('button', { name: /Add another plate/ }));
    await user.type(screen.getByLabelText('Vehicle plate 3 (optional)'), 'third1');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'street.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Plates: ABC123, XYZ789, THIRD1')).toBeTruthy();
  });
});
