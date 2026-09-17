import { describe, expect, it } from 'vitest';
import { parseBlockedCallInput } from '../lib/blocked-call-input';
import { reasonsForScope, searchBlockedReasons } from '../lib/blocked-call-options';
import { BLOCKED_CALL_REASON_OPTIONS } from '../lib/blocked-call-reasons';
import { edmontonTimestamp } from '../lib/report-time';
import { MAX_PHOTO_BYTES, photoSelectionError, validatePhotos } from '../lib/photo-validation';

const input = {
  recordType: 'daily', category: 'Blocked call', scope: 'pickup',
  registeredCommunity: 'Test community', siteAddress: '123 Test Street',
  employeeName: 'Test Driver', reasonCode: 'blocked_by_car',
};
const photoBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64'));

describe('blocked call options and input', () => {
  it('retains every original pickup reason and supports the original aliases', () => {
    expect(reasonsForScope('pickup').slice(0, -1)).toEqual(BLOCKED_CALL_REASON_OPTIONS);
    expect(searchBlockedReasons('pickup', 'car parked in front of bin')[0].code).toBe('blocked_by_car');
    expect(searchBlockedReasons('street', 'crash')[0].code).toBe('accident');
    expect(searchBlockedReasons('street', 'unknown reason').at(-1)?.code).toBe('other');
  });

  it('creates only an open blocked call with the automatic Mountain timestamp', () => {
    const result = parseBlockedCallInput({ ...input, status: 'Resolved', priority: 'Urgent', occurredAt: '1900-01-01', vehiclePlates: ' ABC-123 ', streetFrom: 'Not a street report' }, new Date('2026-09-17T19:00:00Z'));
    expect(result).toMatchObject({ category: 'Blocked call', status: 'Open', priority: 'Normal', occurredAt: '2026-09-17T13:00:00-06:00', resolvedAt: '' });
    expect(result.blockage).toMatchObject({ scope: 'pickup', vehiclePlates: 'ABC-123', streetFrom: '' });
  });

  it('records street extent and ignores pickup-only plates', () => {
    const result = parseBlockedCallInput({ ...input, scope: 'street', reasonCode: 'flooding', streetFrom: 'First Ave', streetTo: 'Third Ave', vehiclePlates: 'Ignored' });
    expect(result.blockage).toMatchObject({ scope: 'street', reasonLabel: 'Flooded street', streetFrom: 'First Ave', streetTo: 'Third Ave', vehiclePlates: '' });
    expect(result.issueDescription).toContain('from First Ave to Third Ave');
  });

  it.each([
    [{ category: 'Incident' }, 'limited to blocked calls'],
    [{ scope: 'street' }, 'Choose a reason'],
    [{ scope: 'invalid' }, 'Choose a pickup'],
    [{ reasonCode: 'other' }, 'Describe the other reason'],
    [{ siteAddress: ' ' }, 'Enter the pickup location'],
    [{ registeredCommunity: '' }, 'Enter the registered community'],
    [{ employeeName: '' }, 'Enter your name'],
    [{ notes: 'x'.repeat(1501) }, 'too long'],
  ])('rejects invalid driver input %j', (patch, message) => {
    expect(() => parseBlockedCallInput({ ...input, ...patch })).toThrow(message);
  });

  it('saves a described other reason', () => {
    expect(parseBlockedCallInput({ ...input, reasonCode: 'other', otherReason: ' Loose livestock ' }).blockage?.reasonLabel).toBe('Loose livestock');
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
