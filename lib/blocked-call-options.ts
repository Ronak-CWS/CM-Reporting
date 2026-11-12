import { BLOCKED_CALL_REASON_OPTIONS, getBlockedCallReasonSuggestions } from './blocked-call-reasons';
import type { BlockageScope } from './report-types';

export const BLOCKED_CALL_SERVICE = 'Recycling';

export interface BlockedReason {
  code: string;
  label: string;
  description: string;
  aliases: string[];
  allowsVehiclePlates?: boolean;
}

export function reasonsForScope(scope: BlockageScope): BlockedReason[] {
  return scope === 'pickup' || scope === 'street' ? [...BLOCKED_CALL_REASON_OPTIONS] : [];
}

export function findBlockedReason(scope: BlockageScope, code: string) {
  return reasonsForScope(scope).find((reason) => reason.code === code);
}

export function searchBlockedReasons(scope: BlockageScope, query: string): BlockedReason[] {
  if (!query.trim()) return reasonsForScope(scope);
  return getBlockedCallReasonSuggestions(query, { limit: 4 });
}

export function blockageScopeLabel(scope: BlockageScope) {
  return scope === 'street' ? 'Street block' : 'Pickup location';
}
