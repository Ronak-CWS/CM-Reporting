// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import LocationAutocomplete from '../app/components/LocationAutocomplete';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Field() {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState(false);
  return <LocationAutocomplete id="community" kind="community" label="Community" value={value} selected={selected} placeholder="Search" onChange={(value, selection) => { setValue(value); setSelected(selection); }} />;
}

describe('location autocomplete', () => {
  it('supports keyboard selection and invalidates the selection when edited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ options: ['Test community'], hasMore: false }) })));
    render(<Field />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'Test');
    await screen.findByRole('option', { name: 'Test community' });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'Test community');
    expect(screen.getByText('Selected from the service list.')).toBeTruthy();
    await user.keyboard('x');
    expect(screen.queryByText('Selected from the service list.')).toBeNull();
  });
  it('ignores old results when a newer search finishes first', async () => {
    let finishOld: (value: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ ok: true, json: async () => ({ options: ['New community'], hasMore: false }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<Field />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'Old');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'New');
    await screen.findByRole('option', { name: 'New community' });
    await act(async () => { finishOld({ ok: true, json: async () => ({ options: ['Old community'], hasMore: false }) }); });
    expect(screen.queryByRole('option', { name: 'Old community' })).toBeNull();
    expect(screen.getByRole('option', { name: 'New community' })).toBeTruthy();
  });
  it('offers a retry after a catalogue error without accepting the typed value', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Connection interrupted'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ options: ['Test community'], hasMore: false }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<Field />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'Test');
    expect((await screen.findByRole('alert')).textContent).toContain('Connection interrupted');
    expect(screen.queryByText('Selected from the service list.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('option', { name: 'Test community' })).toBeTruthy();
  });
});
