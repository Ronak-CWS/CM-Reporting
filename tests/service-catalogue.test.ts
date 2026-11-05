import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLocationCatalogue, type ServiceLocation } from '../lib/location-catalogue';

// Check the shipped catalogue itself: fixture-only tests cannot catch a town
// disappearing when source routing groups are imported into the reporting app.
const rows: ServiceLocation[] = JSON.parse(readFileSync(new URL('../data/service-locations.json', import.meta.url), 'utf8'));
const catalogue = createLocationCatalogue(rows);

describe('shipped service community coverage', () => {
  it('includes every community in the reviewed C9 and Wood Buffalo sources and retains the existing group', () => {
    expect([...new Set(rows.map((row) => row.community))].sort()).toEqual([
      'Anzac', 'Beaver Mines', 'Bellevue', 'Blairmore', 'Brooks', 'Burdett',
      'Cardston', 'Coleman', 'Conklin', 'Coutts', 'Crowsnest Pass', 'Draper',
      'Enchant', 'Foremost', 'Fort Macleod', 'Fort McKay', 'Fort McMurray',
      'Frank', 'Granum', 'Grassy Lake', 'Gregoire Lake Estates', 'Hays',
      'Hillcrest', 'Janvier', 'Lundbreck', 'Magrath', 'Milk River',
      'Pincher Creek', 'Raymond', 'Redcliff', 'Saprae Creek Estates', 'Tilley',
      'Vauxhall', 'Warner', 'Winnifred',
    ]);
  });

  it.each([
    ['Blairmore', 'blair', '13601 20 Ave', '20 Ave'],
    ['Coleman', 'cole', '8610 16 Ave', '16 Ave'],
    ['Frank', 'frank', '14926 21 Ave', '21 Ave'],
    ['Hillcrest', 'hill', '20978 7 Ave', '7 Ave'],
    ['Anzac', 'anzac', '100 CHRISTINA DRIVE', 'CHRISTINA DRIVE'],
    ['Conklin', 'conklin', '101 JACK PINE PLACE', 'JACK PINE PLACE'],
    ['Janvier', 'janvier', '100 MCDONALD AVENUE', 'MCDONALD AVENUE'],
    ['Fort McKay', 'mckay', '21 FORT MCKAY ROAD', 'FORT MCKAY ROAD'],
    ['Saprae Creek Estates', 'saprae', '1 SAPRAE CRESCENT', 'SAPRAE CRESCENT'],
  ])('makes %s searchable and selectable with its source addresses', (community, query, address, street) => {
    expect(catalogue.search('community', query).options).toEqual([community]);
    expect(catalogue.resolveCommunity(` ${community.toLowerCase()} `)).toBe(community);
    expect(catalogue.resolve('pickup', community, address)).toEqual({ registeredCommunity: community, siteAddress: address });
    expect(catalogue.resolve('street', community, street)).toEqual({ registeredCommunity: community, siteAddress: street });
  });

  it.each(['fortmac', 'Fort McMurray', 'Gregoire Lake Estates', 'Draper'])('finds the merged Fort McMurray choice using %s', (query) => {
    expect(catalogue.search('community', query).options).toEqual(['Fort McMurray']);
    expect(catalogue.resolveCommunity(query)).toBe('Fort McMurray');
  });

  it('also finds Fort McMurray with a spaced alias while retaining the Fort Macleod name match', () => {
    expect(catalogue.search('community', 'fort mac').options).toEqual(['Fort Macleod', 'Fort McMurray']);
    expect(catalogue.resolveCommunity('fort mac')).toBe('Fort McMurray');
  });

  it('preserves every city and merged rural location while keeping overlapping addresses distinct', () => {
    const merged = new Set(['Gregoire Lake Estates', 'Draper']);
    const groupedRows = rows.filter((row) => row.community === 'Fort McMurray' || merged.has(row.community));
    expect(groupedRows).toHaveLength(18732);
    for (const row of groupedRows) {
      const suffix = merged.has(row.community) ? ` (${row.community})` : '';
      const address = `${row.address}${suffix}`;
      const street = `${row.street}${suffix}`;
      expect(catalogue.resolve('pickup', 'Fort McMurray', address)).toEqual({ registeredCommunity: 'Fort McMurray', siteAddress: address });
      expect(catalogue.resolve('street', 'Fort McMurray', street)).toEqual({ registeredCommunity: 'Fort McMurray', siteAddress: street });
      // Original rural pairs from an older open form still identify the same place.
      expect(catalogue.resolve('pickup', row.community, row.address)).toEqual({ registeredCommunity: 'Fort McMurray', siteAddress: address });
    }
    expect(catalogue.search('address', '27 poplar crescent', 'Fort McMurray').options).toEqual(expect.arrayContaining([
      '27 POPLAR CRESCENT', '27 POPLAR CRESCENT (Gregoire Lake Estates)',
    ]));
    expect(catalogue.search('address', '100 garden lane', 'Fort McMurray').options).toContain('100 GARDEN LANE (Draper)');
    expect(catalogue.search('address', '1 gregoire avenue', 'fortmac').options).toContain('1 GREGOIRE AVENUE (Gregoire Lake Estates)');
    expect(catalogue.search('address', '27 poplar crescent', 'Gregoire Lake Estates').options).toEqual(['27 POPLAR CRESCENT (Gregoire Lake Estates)']);
    expect(catalogue.resolve('pickup', 'Gregoire Lake Estates', '27 POPLAR CRESCENT (Gregoire Lake Estates)')).toEqual({ registeredCommunity: 'Fort McMurray', siteAddress: '27 POPLAR CRESCENT (Gregoire Lake Estates)' });
    expect(catalogue.resolve('pickup', 'Anzac', '1 GREGOIRE AVENUE (Gregoire Lake Estates)')).toBeNull();
    expect(catalogue.resolve('pickup', 'Fort McMurray', '100 CHRISTINA DRIVE')).toBeNull();
  });

  it('preserves every existing Crowsnest Pass address and restricts town-specific choices', () => {
    const towns = new Set(['Blairmore', 'Coleman', 'Frank', 'Hillcrest']);
    const townRows = rows.filter((row) => towns.has(row.community));
    const groupRows = rows.filter((row) => row.community === 'Crowsnest Pass');
    const locations = (locations: ServiceLocation[]) => new Set(locations.map(({ address, street }) => JSON.stringify([address, street])));
    expect(locations(townRows)).toEqual(locations(groupRows));
    expect(groupRows).toHaveLength(2409);
    expect(catalogue.resolve('pickup', 'Blairmore', '8610 16 Ave')).toBeNull();
    expect(catalogue.resolve('pickup', 'Coleman', '13601 20 Ave')).toBeNull();
  });

  it('uses workbook communities instead of route subareas for boundary addresses', () => {
    // These two workbook rows are Blairmore addresses in the Frank route subarea.
    for (const address of ['14649 16 Ave', '1534 147 St']) {
      expect(catalogue.resolve('pickup', 'Blairmore', address)?.registeredCommunity).toBe('Blairmore');
      expect(catalogue.resolve('pickup', 'Frank', address)).toBeNull();
    }
  });
});
