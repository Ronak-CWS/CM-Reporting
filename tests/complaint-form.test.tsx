// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportingApp from '../app/ReportingApp';
import { createLocationCatalogue, type LocationKind } from '../lib/location-catalogue';
import locations from './fixtures/service-locations.json';

vi.mock('next/image', () => ({ default: () => null }));
const catalogue = createLocationCatalogue(locations);
let submitted: Record<string, unknown>[];

beforeEach(() => {
  submitted = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://cm.test');
    if (url.pathname.endsWith('/api/locations')) {
      return Response.json(catalogue.search(url.searchParams.get('kind') as LocationKind, url.searchParams.get('q') || ''));
    }
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body));
      submitted.push(payload);
      return Response.json({ record: { ...payload, id: 'test-complaint', referenceNumber: 'CM-CMP-TEST', reportedAt: '2026-10-04T20:00:00Z', photos: [] } }, { status: 201 });
    }
    return Response.json({ records: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openForm() {
  render(<ReportingApp user={{ tenantId: '11111111-2222-3333-4444-555555555555', objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Test Staff', username: 'staff@example.invalid' }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Log complaint' }));
  return user;
}
function fillRequiredDetails() {
  for (const [label, value] of [
    ['Employee title', 'Dispatcher'], ['Customer name', 'Test Customer'],
    ['Address', '456 Example Avenue'],
    ['Description of inquiry or complaint', 'Details of the complaint.'],
  ]) fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
  fireEvent.change(screen.getByLabelText(/^Contact medium/), { target: { value: 'Phone call' } });
  fireEvent.change(screen.getByLabelText(/^Inquiry or complaint category/), { target: { value: 'Service quality' } });
}
async function selectCommunity(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('combobox', { name: 'Registered community' }), 'Tes');
  await user.click(await screen.findByRole('option', { name: 'Test community' }));
}

describe('complaint community selection', () => {
  it('requires choosing a suggestion and invalidates an edited selection', async () => {
    const user = await openForm();
    fillRequiredDetails();
    const community = screen.getByRole('combobox', { name: 'Registered community' });
    await user.type(community, 'Test community');
    await screen.findByRole('option', { name: 'Test community' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Log an inquiry or complaint' })).toBeDefined();
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    expect(screen.getByRole('alert').textContent).toContain('Choose a registered community');
    expect(submitted).toHaveLength(0);
    await user.click(community);
    await user.click(await screen.findByRole('option', { name: 'Test community' }));
    await user.type(community, 'x');
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    expect(submitted).toHaveLength(0);
  });
  it('prefills the signed-in employee name and submits it with the selected community', async () => {
    const user = await openForm();
    expect(screen.getByLabelText(/^Employee name/)).toHaveProperty('value', 'Test Staff');
    fillRequiredDetails();
    await selectCommunity(user);
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ registeredCommunity: 'Test community', recordType: 'complaint', employeeName: 'Test Staff', customerContactInformation: '' });
    expect(screen.queryByRole('dialog', { name: 'Log an inquiry or complaint' })).toBeNull();
  });
});

describe('complaint Other explanation', () => {
  it('requires an explanation and submits its trimmed value', async () => {
    const user = await openForm();
    fillRequiredDetails();
    await selectCommunity(user);
    await user.selectOptions(screen.getByLabelText(/^Inquiry or complaint category/), 'Other');
    const reason = screen.getByLabelText(/^Explain the other reason/) as HTMLTextAreaElement;
    expect(reason.required).toBe(true);
    expect(reason.maxLength).toBe(500);
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    expect(submitted).toHaveLength(0);
    fireEvent.change(reason, { target: { value: '   ' } });
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    expect(screen.getByRole('alert').textContent).toContain('Explain the reason for choosing Other.');
    expect(submitted).toHaveLength(0);
    fireEvent.change(reason, { target: { value: '  Community information request  ' } });
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ category: 'Other', categoryOtherReason: 'Community information request' });
    await user.click(screen.getByRole('button', { name: /^CM-CMP-TEST/ }));
    expect(screen.getByText('Other category reason')).toBeDefined();
    expect(screen.getByText('Community information request')).toBeDefined();
  });
  it('clears the explanation when switching away from Other', async () => {
    const user = await openForm();
    fillRequiredDetails();
    await selectCommunity(user);
    const category = screen.getByLabelText(/^Inquiry or complaint category/);
    await user.selectOptions(category, 'Other');
    fireEvent.change(screen.getByLabelText(/^Explain the other reason/), { target: { value: 'Not applicable anymore' } });
    await user.selectOptions(category, 'Missed collection');
    expect(screen.queryByLabelText(/^Explain the other reason/)).toBeNull();
    await user.selectOptions(category, 'Other');
    expect((screen.getByLabelText(/^Explain the other reason/) as HTMLTextAreaElement).value).toBe('');
    await user.selectOptions(category, 'Missed collection');
    await user.click(screen.getByRole('button', { name: 'Save complaint' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ category: 'Missed collection', categoryOtherReason: '' });
  });
});
