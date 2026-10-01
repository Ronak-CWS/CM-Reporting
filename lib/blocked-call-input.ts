import { findBlockedReason, blockageScopeLabel } from './blocked-call-options';
import type { BlockageScope, CreateReportRecordInput } from './report-types';
import { edmontonTimestamp } from './report-time';

import { InputError } from './input-error';
export { InputError } from './input-error';

function text(body: Record<string, unknown>, key: string, limit = 250) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if (value.length > limit) throw new InputError(`${key} is too long (maximum ${limit} characters).`);
  return value;
}

export function parseBlockedCallInput(payload: unknown, now = new Date()): CreateReportRecordInput {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (body.category && body.category !== 'Blocked call') {
    throw new InputError('Daily submissions are limited to blocked calls.');
  }
  if (body.scope !== 'pickup' && body.scope !== 'street') {
    throw new InputError('Choose a pickup location or a street block.');
  }
  const scope: BlockageScope = body.scope;
  const reason = findBlockedReason(scope, text(body, 'reasonCode'));
  if (!reason) throw new InputError('Choose a reason for this type of blockage.');
  const otherReason = reason.code === 'other' ? text(body, 'otherReason', 500) : '';
  if (reason.code === 'other' && !otherReason) throw new InputError('Describe the other reason.');
  const registeredCommunity = text(body, 'registeredCommunity');
  const siteAddress = text(body, 'siteAddress', 500);
  const employeeName = text(body, 'employeeName');
  if (!registeredCommunity) throw new InputError('Enter the registered community.');
  if (!siteAddress) throw new InputError(scope === 'street' ? 'Enter the blocked street.' : 'Enter the pickup location.');
  if (!employeeName) throw new InputError('Enter your name.');
  const reasonLabel = reason.code === 'other' ? otherReason : reason.label;
  const streetFrom = scope === 'street' ? text(body, 'streetFrom') : '';
  const streetTo = scope === 'street' ? text(body, 'streetTo') : '';
  const notes = text(body, 'notes', 1500);
  const vehiclePlates = scope === 'pickup' && reason.requiresVehiclePlate ? text(body, 'vehiclePlates', 500) : '';
  const section = [streetFrom && `from ${streetFrom}`, streetTo && `to ${streetTo}`].filter(Boolean).join(' ');
  const issueDescription = [
    `${blockageScopeLabel(scope)} blocked: ${siteAddress}${section ? ` (${section})` : ''}.`,
    `Reason: ${reasonLabel}.`,
    vehiclePlates && `Vehicle plates: ${vehiclePlates}.`,
    notes,
  ].filter(Boolean).join(' ');

  return {
    recordType: 'daily', occurredAt: edmontonTimestamp(now), registeredCommunity,
    siteAddress, routeNumber: text(body, 'routeNumber', 80), serviceType: text(body, 'serviceType', 80),
    category: 'Blocked call', priority: 'Normal', status: 'Open',
    employeeName, employeeTitle: '', contactMedium: '', customerName: '',
    customerAddress: '', customerContactInformation: '', issueDescription,
    rootCause: reasonLabel, correctiveAction: '', resolutionDescription: '',
    resolutionDueAt: '', resolvedAt: '', assignedTo: '',
    blockage: { scope, reasonCode: reason.code, reasonLabel, streetFrom, streetTo, notes, vehiclePlates },
  };
}
