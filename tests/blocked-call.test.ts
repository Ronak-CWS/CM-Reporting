import { describe, expect, it, vi } from 'vitest';
import { parseBlockedCallInput } from '../lib/blocked-call-input';
import { reasonsForScope, searchBlockedReasons } from '../lib/blocked-call-options';
import { BLOCKED_CALL_REASON_OPTIONS } from '../lib/blocked-call-reasons';
import { edmontonTimestamp } from '../lib/report-time';
import { MAX_PHOTO_BYTES, photoSelectionError, validatePhotos } from '../lib/photo-validation';

vi.mock('../lib/location-catalogue-store', async () => {
  const { createLocationCatalogue } = await import('../lib/location-catalogue');
  const catalogue = createLocationCatalogue((await import('./fixtures/service-locations.json')).default);
  return { getLocationCatalogue: () => catalogue };
});

const input = {
  recordType: 'daily', category: 'Blocked call', scope: 'pickup',
  registeredCommunity: 'Test community', siteAddress: '123 Test Street',
  employeeName: 'Test Driver', reasonCode: 'obstruction', vehiclePlates: ['ABC-123'],
};
const photoBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64'));

describe('blocked call options and input', () => {
  it.each(['pickup', 'street'] as const)('offers only the four requested reasons for %s reports', (scope) => {
    expect(reasonsForScope(scope)).toEqual(BLOCKED_CALL_REASON_OPTIONS);
    expect(reasonsForScope(scope).map(reason => reason.label)).toEqual(['Bin spacing', 'Obstruction', 'Bin not out', 'OOPs']);
    for (const reason of reasonsForScope(scope)) expect(reason.description).toMatch(/^Use this when /);
    for (const alias of ['car', 'truck', 'van', 'fence', 'gate']) {
      expect(searchBlockedReasons(scope, alias)[0].code).toBe('obstruction');
    }
    expect(searchBlockedReasons(scope, 'other')).toEqual([]);
  });

  it.each(['pickup', 'street'] as const)('accepts all four reasons without vehicle plates for %s reports', (scope) => {
    for (const reason of reasonsForScope(scope)) {
      const result = parseBlockedCallInput({ ...input, scope, siteAddress: scope === 'street' ? 'Test Street' : '123 Test Street', reasonCode: reason.code, vehiclePlates: [] });
      expect(result.blockage).toMatchObject({ reasonCode: reason.code, reasonLabel: reason.label, vehiclePlates: '' });
    }
  });

  it('creates only an open blocked call with the automatic Mountain timestamp', () => {
    const result = parseBlockedCallInput({ ...input, status: 'Resolved', priority: 'Urgent', occurredAt: '1900-01-01', vehiclePlates: ' ABC-123 ', streetFrom: 'Not a street report' }, new Date('2026-09-17T19:00:00Z'));
    expect(result).toMatchObject({ category: 'Blocked call', serviceType: 'Recycling', status: 'Open', priority: 'Normal', occurredAt: '2026-09-17T13:00:00-06:00', resolvedAt: '' });
    expect(result.blockage).toMatchObject({ scope: 'pickup', reasonCode: 'obstruction', reasonLabel: 'Obstruction', vehiclePlates: 'ABC-123', streetFrom: '' });
  });

  it('records street extent and discards plates for a reason unrelated to vehicles', () => {
    const result = parseBlockedCallInput({ ...input, scope: 'street', siteAddress: 'Test Street', reasonCode: 'bins_not_out', streetFrom: 'First Ave', streetTo: 'Third Ave', vehiclePlates: 'Ignored' });
    expect(result.blockage).toMatchObject({ scope: 'street', reasonLabel: 'Bin not out', streetFrom: 'First Ave', streetTo: 'Third Ave', vehiclePlates: '' });
    expect(result.issueDescription).toContain('from First Ave to Third Ave');
  });

  it.each([
    [{ category: 'Incident' }, 'limited to blocked calls'],
    [{ reasonCode: '' }, 'Choose a reason'],
    [{ scope: 'invalid' }, 'Choose a pickup'],
    [{ reasonCode: 'other', otherReason: 'Loose livestock' }, 'Choose a reason'],
    [{ reasonCode: 'blocked_by_vehicle' }, 'Choose a reason'],
    [{ reasonCode: 'blocked_by_multiple_vehicles' }, 'Choose a reason'],
    [{ reasonCode: 'flooding' }, 'Choose a reason'],
    [{ siteAddress: ' ' }, 'Enter the pickup location'],
    [{ registeredCommunity: '' }, 'Enter the registered community'],
    [{ employeeName: '' }, 'Enter your name'],
    [{ notes: 'x'.repeat(1501) }, 'too long'],
  ])('rejects invalid driver input %j', (patch, message) => {
    expect(() => parseBlockedCallInput({ ...input, ...patch })).toThrow(message);
  });

  it.each([
    [undefined, 'OOPs'],
    ['   ', 'OOPs'],
    [' Incorrect contents ', 'OOPs: Incorrect contents'],
  ])('accepts optional OOPs tag details: %s', (oopsTagReason, reasonLabel) => {
    const report = parseBlockedCallInput({ ...input, reasonCode: 'oops_tag', oopsTagReason, vehiclePlates: [] });
    expect(report.blockage).toMatchObject({ reasonCode: 'oops_tag', reasonLabel, vehiclePlates: '' });
    expect(report.issueDescription).toContain('Reason: ' + reasonLabel + '.');
    expect(report.rootCause).toBe(reasonLabel);
  });

  it('bounds OOPs tag details and ignores stale details for other categories', () => {
    expect(() => parseBlockedCallInput({ ...input, reasonCode: 'oops_tag', oopsTagReason: 'x'.repeat(501) })).toThrow('too long');
    expect(parseBlockedCallInput({ ...input, oopsTagReason: 'Stale tag detail', otherReason: 'Old reason text' }).blockage?.reasonLabel).toBe('Obstruction');
  });

  it.each([
    [{ vehiclePlates: ['abc-123', 'ABC 123'] }, 'different plate'],
    [{ vehiclePlates: ['ABC/123'] }, 'one plate per field'],
    [{ vehiclePlates: ['A'.repeat(33)] }, 'one plate per field'],
    [{ vehiclePlates: Array.from({ length: 20 }, (_, i) => 'A'.repeat(25) + i) }, 'too long'],
    [{ vehiclePlates: [123] }, 'valid vehicle plate list'],
    [{ siteAddress: 'An unlisted address' }, 'from the service address list'],
    [{ registeredCommunity: 'Second community' }, 'from the service address list'],
  ])('validates supplied plates and approved locations on the server: %j', (patch, message) => {
    expect(() => parseBlockedCallInput({ ...input, ...patch })).toThrow(message);
  });

  it('normalizes and saves plates for one or more vehicles under Obstruction', () => {
    const report = parseBlockedCallInput({ ...input, vehiclePlates: [' abc-123 ', 'XYZ 789', 'THIRD-1', ''] });
    expect(report.blockage?.vehiclePlates).toBe('ABC-123, XYZ 789, THIRD-1');
    expect(report.issueDescription).toContain('ABC-123, XYZ 789, THIRD-1');
  });

  it('handles daylight and standard Mountain time', () => {
    expect(edmontonTimestamp(new Date('2026-01-02T01:30:00Z'))).toBe('2026-01-01T18:30:00-07:00');
    expect(edmontonTimestamp(new Date('2026-07-02T01:30:00Z'))).toBe('2026-07-01T19:30:00-06:00');
  });
});

describe('photo evidence', () => {
  it('requires a photo and enforces number, file size and total size', () => {
    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 1 };
    expect(photoSelectionError([])).toContain('at least one');
    expect(photoSelectionError(Array(7).fill(file))).toContain('up to 6');
    expect(photoSelectionError([{ ...file, size: MAX_PHOTO_BYTES + 1 }])).toContain('10 MB');
    expect(photoSelectionError(Array(4).fill({ ...file, size: MAX_PHOTO_BYTES }))).toContain('30 MB');
  });

  it('validates actual image bytes and sanitizes the display filename', async () => {
    const photos = await validatePhotos([new File([photoBytes], '../photo.png', { type: 'image/png' })]);
    expect(photos[0]).toMatchObject({ fileName: '.._photo.png', contentType: 'image/png' });
    expect(new Uint8Array(photos[0].bytes)).toEqual(photoBytes);
    await expect(validatePhotos([new File(['<script>not an image</script>'], 'fake.jpg', { type: 'image/jpeg' })])).rejects.toThrow('does not contain');
    await expect(validatePhotos([new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })])).rejects.toThrow('not a supported photo');
  });
});
