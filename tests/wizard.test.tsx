// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockedCallWizard from '../app/components/BlockedCallWizard';

vi.mock('next/image', () => ({ default: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  URL.createObjectURL = vi.fn(() => 'blob:photo-test');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function reachPhotos(scope: 'pickup' | 'street' = 'pickup') {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: scope === 'pickup' ? /A pickup location/ : /A street \/ street block/ }));
  await user.type(screen.getByLabelText('Community'), 'Test community');
  await user.type(screen.getByLabelText(scope === 'pickup' ? 'Pickup address or site' : 'Street name'), '123 Test Street');
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.click(screen.getByRole('button', { name: scope === 'pickup' ? /Blocked by car/ : /Flooded street/ }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  return user;
}

describe('simple driver flow', () => {
  it('shows one task at a time and preserves location on Back', async () => {
    render(<BlockedCallWizard onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'What is blocked?' })).toBeTruthy();
    expect(screen.queryByLabelText('Community')).toBeNull();
    const user = await reachPhotos();
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('Blocked by car')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect((screen.getByLabelText('Pickup address or site') as HTMLInputElement).value).toBe('123 Test Street');
    expect(screen.queryByLabelText('Status')).toBeNull();
  });

  it('requires and removes photos for a street report', async () => {
    render(<BlockedCallWizard onClose={vi.fn()} onSaved={vi.fn()} />);
    const user = await reachPhotos('street');
    expect((screen.getByLabelText('Take a blockage photo') as HTMLInputElement).getAttribute('capture')).toBe('environment');
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
    vi.stubGlobal('fetch', fetchMock);
    render(<BlockedCallWizard onClose={vi.fn()} onSaved={onSaved} />);
    const user = await reachPhotos('street');
    await user.upload(screen.getByLabelText('Upload blockage photos'), new File(['test-image'], 'street.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.type(screen.getByLabelText(/Your name/), 'Test Driver');
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
    render(<BlockedCallWizard onClose={onClose} onSaved={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /A pickup location/ }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
