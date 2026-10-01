export interface ServiceLocation { community: string; address: string; street: string }
export type LocationKind = 'community' | 'address' | 'street';
export interface LocationSuggestions { options: string[]; hasMore: boolean }

function key(value: string) { return value.trim().toLocaleLowerCase('en-CA'); }

export function createLocationCatalogue(rows: ServiceLocation[]) {
  const communities = new Map<string, { label: string; addresses: Map<string, string>; streets: Map<string, string> }>();
  for (const row of rows) {
    if (!row || typeof row.community !== 'string' || !row.community.trim() || typeof row.address !== 'string' || !row.address.trim() || typeof row.street !== 'string') {
      throw new Error('Each service location needs a community, address and street field.');
    }
    const communityKey = key(row.community);
    const community = communities.get(communityKey) || { label: row.community.trim(), addresses: new Map<string, string>(), streets: new Map<string, string>() };
    community.addresses.set(key(row.address), row.address.trim());
    if (row.street.trim()) community.streets.set(key(row.street), row.street.trim());
    communities.set(communityKey, community);
  }
  const sort = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b, 'en-CA', { numeric: true }));
  const communityLabels = sort([...communities.values()].map((community) => community.label));
  const lists = new Map([...communities].map(([id, community]) => [id, {
    addresses: sort(community.addresses.values()), streets: sort(community.streets.values()),
  }]));

  return {
    available: communities.size > 0,
    search(kind: LocationKind, query: string, community = ''): LocationSuggestions {
      const list = kind === 'community' ? communityLabels : lists.get(key(community))?.[kind === 'street' ? 'streets' : 'addresses'] || [];
      const tokens = key(query).split(/\s+/).filter(Boolean);
      const matches: string[] = [];
      for (const value of list) {
        if (tokens.every((token) => key(value).includes(token))) matches.push(value);
        if (matches.length === 26) break;
      }
      return { options: matches.slice(0, 25), hasMore: matches.length > 25 };
    },
    resolve(scope: 'pickup' | 'street', communityName: string, location: string) {
      const community = communities.get(key(communityName));
      if (!community) return null;
      const siteAddress = (scope === 'street' ? community.streets : community.addresses).get(key(location));
      return siteAddress ? { registeredCommunity: community.label, siteAddress } : null;
    },
  };
}
