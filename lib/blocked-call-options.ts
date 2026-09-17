import { BLOCKED_CALL_REASON_OPTIONS, getBlockedCallReasonSuggestions } from './blocked-call-reasons';
import type { BlockageScope } from './report-types';

export interface BlockedReason {
  code: string;
  label: string;
  aliases: string[];
  requiresVehiclePlate?: boolean;
  allowsMultipleVehiclePlates?: boolean;
}

export const OTHER_REASON: BlockedReason = { code: 'other', label: 'Other reason', aliases: [] };

export const STREET_BLOCK_REASONS: BlockedReason[] = [
  { code: 'ongoing_construction', label: 'Ongoing construction', aliases: ['roadworks', 'road work', 'construction'] },
  { code: 'flooding', label: 'Flooded street', aliases: ['flood', 'water', 'flooding'] },
  { code: 'no_road_access', label: 'No road access', aliases: ['closed', 'closure', 'barricade', 'barrier'] },
  { code: 'accident', label: 'Accident', aliases: ['collision', 'crash'] },
  { code: 'snow_or_ice', label: 'Snow or ice', aliases: ['snowbank', 'icy', 'snow', 'ice'] },
  { code: 'emergency_closure', label: 'Emergency closure', aliases: ['police', 'fire', 'emergency'] },
  { code: 'fallen_tree_or_debris', label: 'Fallen tree or debris', aliases: ['branches', 'tree', 'debris', 'obstruction'] },
  { code: 'road_damage', label: 'Road damage or washout', aliases: ['sinkhole', 'potholes', 'washout', 'road damage'] },
  { code: 'vehicles_blocking_street', label: 'Vehicles blocking the street', aliases: ['parked', 'cars', 'trucks', 'vehicles'] },
  { code: 'event_closure', label: 'Event or parade closure', aliases: ['event', 'festival', 'parade'] },
];

export function reasonsForScope(scope: BlockageScope): BlockedReason[] {
  return [...(scope === 'street' ? STREET_BLOCK_REASONS : BLOCKED_CALL_REASON_OPTIONS), OTHER_REASON];
}

export function findBlockedReason(scope: BlockageScope, code: string) {
  return reasonsForScope(scope).find((reason) => reason.code === code);
}

export function searchBlockedReasons(scope: BlockageScope, query: string): BlockedReason[] {
  if (!query.trim()) return reasonsForScope(scope);
  if (scope === 'pickup') {
    return [...getBlockedCallReasonSuggestions(query, { limit: 15 }), OTHER_REASON];
  }
  const tokens = query.toLowerCase().trim().split(/\s+/);
  return [...STREET_BLOCK_REASONS.filter((reason) => {
    const text = [reason.label, ...reason.aliases].join(' ').toLowerCase();
    return tokens.every((token) => text.includes(token));
  }), OTHER_REASON];
}

export function blockageScopeLabel(scope: BlockageScope) {
  return scope === 'street' ? 'Street block' : 'Pickup location';
}
