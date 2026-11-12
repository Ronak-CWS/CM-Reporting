import type { BlockedReason } from './blocked-call-options';

export function normalizedVehiclePlates(plates: string[]) {
  return plates.map((plate) => plate.trim().toUpperCase()).filter(Boolean);
}

export function vehiclePlateError(reason: BlockedReason, values: string[]) {
  if (!reason.allowsVehiclePlates) return '';
  const plates = normalizedVehiclePlates(values);
  if (plates.some((plate) => plate.length > 32 || !/^[A-Z0-9][A-Z0-9 -]*$/.test(plate))) {
    return 'Enter one plate per field using letters, numbers, spaces or hyphens.';
  }
  if (plates.join(', ').length > 500) return 'The vehicle plate list is too long.';
  const distinct = new Set(plates.map((plate) => plate.replace(/[ -]/g, '')));
  if (distinct.size !== plates.length) return 'Each vehicle must have a different plate.';
  return '';
}
