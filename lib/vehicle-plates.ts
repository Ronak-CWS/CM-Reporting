import type { BlockedReason } from './blocked-call-options';

export function normalizedVehiclePlates(plates: string[]) {
  return plates.map((plate) => plate.trim().toUpperCase()).filter(Boolean);
}

export function vehiclePlateError(reason: BlockedReason, values: string[]) {
  if (!reason.requiresVehiclePlate) return '';
  const plates = normalizedVehiclePlates(values);
  const minimum = reason.allowsMultipleVehiclePlates ? 2 : 1;
  if (plates.length < minimum) return minimum === 2
    ? 'Enter at least two different vehicle plates.' : 'Enter the vehicle plate.';
  if (!reason.allowsMultipleVehiclePlates && plates.length !== 1) {
    return 'Enter one plate, or choose “Blocked by multiple vehicles”.';
  }
  if (plates.some((plate) => plate.length > 32 || !/^[A-Z0-9][A-Z0-9 -]*$/.test(plate))) {
    return 'Enter one plate per field using letters, numbers, spaces or hyphens.';
  }
  if (plates.join(', ').length > 500) return 'The vehicle plate list is too long.';
  const distinct = new Set(plates.map((plate) => plate.replace(/[ -]/g, '')));
  if (distinct.size !== plates.length) return 'Each vehicle must have a different plate.';
  return '';
}
