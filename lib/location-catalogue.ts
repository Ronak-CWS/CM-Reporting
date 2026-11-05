export interface ServiceLocation { community: string; address: string; street: string }
export type LocationKind = 'community' | 'address' | 'street';
export interface LocationSuggestions { options: string[]; hasMore: boolean }

function key(value: string) { return value.trim().toLocaleLowerCase('en-CA'); }

const fortMcMurray = 'Fort McMurray';
const mergedLocalities = new Map([
  ['gregoire lake estates', 'Gregoire Lake Estates'],
  ['draper', 'Draper'],
]);
const fortMacAliases = ['fortmac', 'fort mac'];

function communityKey(value: string) {
  const id = key(value);
  return mergedLocalities.has(id) || fortMacAliases.includes(id) ? key(fortMcMurray) : id;
}

function locationLabel(value: string, community: string) {
  const locality = mergedLocalities.get(key(community));
  const label = value.trim();
  return locality && !key(label).endsWith(key(` (${locality})`)) ? `${label} (${locality})` : label;
}

export function createLocationCatalogue(rows: ServiceLocation[]) {
  const communities = new Map<string, { label: string; addresses: Map<string, string>; streets: Map<string, string> }>();
  for (const row of rows) {
    if (!row || typeof row.community !== 'string' || !row.community.trim() || typeof row.address !== 'string' || !row.address.trim() || typeof row.street !== 'string') {
      throw new Error('Each service location needs a community, address and street field.');
    }
    const id = communityKey(row.community);
    const community = communities.get(id) || { label: id === key(fortMcMurray) ? fortMcMurray : row.community.trim(), addresses: new Map<string, string>(), streets: new Map<string, string>() };
    // Keep the locality in merged locations: city and rural house numbers can overlap.
    const address = locationLabel(row.address, row.community);
    community.addresses.set(key(address), address);
    if (row.street.trim()) {
      const street = locationLabel(row.street, row.community);
      community.streets.set(key(street), street);
    }
    communities.set(id, community);
  }
  const sort = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b, 'en-CA', { numeric: true }));
  const communityLabels = sort([...communities.values()].map((community) => community.label));
  const lists = new Map([...communities].map(([id, community]) => [id, {
    addresses: sort(community.addresses.values()), streets: sort(community.streets.values()),
  }]));

  return {
    available: communities.size > 0,
    resolveCommunity(name: string) {
      return communities.get(communityKey(name))?.label || null;
    },
    search(kind: LocationKind, query: string, community = ''): LocationSuggestions {
      const list = kind === 'community' ? communityLabels : lists.get(communityKey(community))?.[kind === 'street' ? 'streets' : 'addresses'] || [];
      const tokens = key(query).split(/\s+/).filter(Boolean);
      const matches: string[] = [];
      const locality = mergedLocalities.get(key(community));
      for (const value of list) {
        if (kind !== 'community' && locality && !value.endsWith(` (${locality})`)) continue;
        const aliases = kind === 'community' && value === fortMcMurray ? [...fortMacAliases, ...mergedLocalities.values()] : [];
        const labels = [value, ...aliases].map(key);
        if (labels.some((label) => tokens.every((token) => label.includes(token)))) matches.push(value);
        if (matches.length === 26) break;
      }
      return { options: matches.slice(0, 25), hasMore: matches.length > 25 };
    },
    resolve(scope: 'pickup' | 'street', communityName: string, location: string) {
      const community = communities.get(communityKey(communityName));
      if (!community) return null;
      // Older open forms can still submit their original rural community/location pair.
      const siteAddress = (scope === 'street' ? community.streets : community.addresses).get(key(locationLabel(location, communityName)));
      return siteAddress ? { registeredCommunity: community.label, siteAddress } : null;
    },
  };
}
