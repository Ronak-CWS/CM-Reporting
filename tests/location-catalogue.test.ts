import { describe, expect, it, vi } from 'vitest';
import { createLocationCatalogue } from '../lib/location-catalogue';
import locations from './fixtures/service-locations.json';
import { GET } from '../app/api/locations/route';
import { parseBlockedCallInput } from '../lib/blocked-call-input';

// An empty list must fail closed; test addresses never seed the app catalogue.
vi.mock('../lib/location-catalogue-store', async () => {
  const { createLocationCatalogue } = await import('../lib/location-catalogue');
  return { getLocationCatalogue: () => createLocationCatalogue([]) };
});

describe('approved location catalogue', () => {
  const catalogue = createLocationCatalogue(locations);
  it('filters addresses and streets to the selected community and searches all words', () => {
    expect(catalogue.search('community', 'test').options).toEqual(['Test community']);
    expect(catalogue.search('address', 'street 123', 'test community').options).toEqual(['123 Test Street']);
    expect(catalogue.search('street', 'test', 'Test community').options).toEqual(['Test Avenue', 'Test Street']);
    expect(catalogue.search('address', '789', 'Test community').options).toEqual([]);
    expect(catalogue.search('address', '', 'Unknown community').options).toEqual([]);
  });
  it('rejects unmatched address/community pairs and resolves canonical labels', () => {
    expect(catalogue.resolve('pickup', 'Second community', '123 Test Street')).toBeNull();
    expect(catalogue.resolve('street', 'Test community', '123 Test Street')).toBeNull();
    expect(catalogue.resolve('pickup', 'test community', '123 test street')).toEqual({ registeredCommunity: 'Test community', siteAddress: '123 Test Street' });
  });
  it('deduplicates options and bounds results without hiding that more matches exist', () => {
    const many = createLocationCatalogue([...locations, ...locations, ...Array.from({ length: 30 }, (_, index) => ({ community: 'Test community', address: `${index + 1} Example Road`, street: 'Example Road' }))]);
    const result = many.search('address', 'example', 'Test community');
    expect(result.options).toHaveLength(25);
    expect(result.hasMore).toBe(true);
    expect(result.options.slice(0, 3)).toEqual(['1 Example Road', '2 Example Road', '3 Example Road']);
    expect(many.search('street', 'example', 'Test community').options).toEqual(['Example Road']);
  });
  it('does not accept driver free text when the catalogue is missing', async () => {
    const response = await GET(new Request('https://cm.test/api/locations?kind=community'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(() => parseBlockedCallInput({ recordType: 'daily', scope: 'pickup', reasonCode: 'other', otherReason: 'Livestock', registeredCommunity: 'Test community', siteAddress: '123 Test Street', employeeName: 'Driver' })).toThrow('service address list is not available');
    expect((await GET(new Request('https://cm.test/api/locations?kind=invalid'))).status).toBe(400);
  });
});
