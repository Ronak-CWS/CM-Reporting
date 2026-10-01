const ORIGINAL_BLOCKED_CALL_REASONS = [
  {
    aliases: [
      'car',
      'blocked by car',
      'blocked by a car',
      'car in the way',
      'car in way',
      'car parked in the way',
      'car parked in front of bin',
      'car parked in front of doors',
      'car blocking the bin',
      'car blocked the bin',
      'parked car',
      'car blocking access',
      'car blocking the way',
      'car in front',
      'car is on the front of the bin',
      'cars in the way',
      'vehicle parked in the way',
      'access blocked by car',
    ],
    code: 'blocked_by_car',
    label: 'Blocked by car',
    requiresVehiclePlate: true,
  },
  {
    aliases: [
      'truck',
      'blocked by truck',
      'blocked by a truck',
      'moving truck',
      'pickup truck',
      'truck in the way',
      'truck in front',
      'truck parked in entrance',
      'truck parked in front of door',
      'truck parked in the way',
      'truck blocking access',
      'truck blocking the bin',
      'truck and trailer',
      'truck and trailer in the way',
      'delivery truck',
      'moving truck in the way',
      'blocked by moving truck',
    ],
    code: 'blocked_by_truck',
    label: 'Blocked by truck',
    requiresVehiclePlate: true,
  },
  {
    aliases: [
      'van',
      'blocked by van',
      'blocked by a van',
      'delivery van',
      'van in the way',
      'van in way',
      'van blocking access',
      'van blocking the bin',
      'van blocking the access to the bin',
      'u haul van',
      'moving van',
      'mini van',
    ],
    code: 'blocked_by_van',
    label: 'Blocked by van',
    requiresVehiclePlate: true,
  },
  {
    aliases: [
      'vehicle',
      'blocked by vehicle',
      'blocked by a vehicle',
      'vehicle blocking access',
      'vehicle too close to the bin',
      'vehicle too close to bin',
    ],
    code: 'blocked_by_vehicle',
    label: 'Blocked by vehicle',
    requiresVehiclePlate: true,
  },
  {
    aliases: [
      'multiple vehicles',
      'vehicles blocking access',
      'many vehicles',
      'cars blocking access',
      'parking lot full',
      'multiple cars',
      'multiple vehicles blocking access',
      'several vehicles',
    ],
    code: 'blocked_by_multiple_vehicles',
    label: 'Blocked by multiple vehicles',
    requiresVehiclePlate: true,
    allowsMultipleVehiclePlates: true,
  },
  {
    aliases: [
      'construction',
      'construction blocking access',
      'site construction',
      'equipment blocking access',
      'materials blocking access',
    ],
    code: 'construction_blocking_access',
    label: 'Construction blocking access',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'snow',
      'ice',
      'snow or ice',
      'icy access',
      'snow blocking access',
      'ice buildup',
    ],
    code: 'snow_or_ice_blocking_access',
    label: 'Snow or ice blocking access',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'gate locked',
      'locked gate',
      'site locked',
      'lock',
      'locked enclosure',
    ],
    code: 'gate_or_site_lock',
    label: 'Gate locked or site locked',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'fence',
      'behind fence',
      'enclosure',
      'blocked by fence',
      'fence locked',
    ],
    code: 'fence_or_enclosure_blocking_access',
    label: 'Fence or enclosure blocking access',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'door issue',
      'broken door',
      'door latch',
      'latch issue',
      'door malfunction',
      'garage door issue',
    ],
    code: 'door_or_latch_issue',
    label: 'Door or latch issue',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'bins not out',
      'bin not out',
      'cart not out',
      'carts not out',
      'not out for service',
    ],
    code: 'bins_not_out',
    label: 'Bins not out',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'fire',
      'bin fire',
      'fire in bin',
      'burnt bin',
    ],
    code: 'bin_fire',
    label: 'Bin fire',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'bin stuck',
      'stuck bin',
      'too heavy',
      'heavy bin',
      'frozen wheels',
      'burnt bin full of water',
    ],
    code: 'bin_too_heavy_or_stuck',
    label: 'Bin too heavy or stuck',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'furniture',
      'material blocking access',
      'construction material',
      'debris blocking access',
      'items in front of bin',
    ],
    code: 'material_or_furniture_blocking_access',
    label: 'Material or furniture blocking access',
    requiresVehiclePlate: false,
  },
  {
    aliases: [
      'site damage',
      'unsafe access',
      'damaged site',
      'unsafe to collect',
      'unsafe area',
    ],
    code: 'site_damage_or_unsafe_access',
    label: 'Site damage or unsafe access',
    requiresVehiclePlate: false,
  },
];

const SINGLE_VEHICLE_CODES = new Set([
  'blocked_by_car', 'blocked_by_truck', 'blocked_by_van', 'blocked_by_vehicle',
]);

export const BLOCKED_CALL_REASON_OPTIONS = [
  {
    code: 'blocked_by_vehicle',
    label: 'Blocked by a vehicle',
    requiresVehiclePlate: true,
    aliases: ORIGINAL_BLOCKED_CALL_REASONS
      .filter((option) => SINGLE_VEHICLE_CODES.has(option.code))
      .flatMap((option) => [option.label, ...option.aliases]),
  },
  ...ORIGINAL_BLOCKED_CALL_REASONS.filter((option) => !SINGLE_VEHICLE_CODES.has(option.code)),
];

function normalizeReasonText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getNormalizedReasonValues(option) {
  return [
    normalizeReasonText(option.label),
    ...option.aliases.map((alias) => normalizeReasonText(alias)),
  ].filter(Boolean);
}

function scoreReasonOption(option, normalizedQuery) {
  const normalizedLabel = normalizeReasonText(option.label);
  const normalizedAliases = option.aliases.map((alias) => normalizeReasonText(alias));

  if (!normalizedQuery) {
    return 10;
  }

  if (normalizedLabel === normalizedQuery) {
    return 0;
  }

  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 1;
  }

  for (const normalizedAlias of normalizedAliases) {
    if (normalizedAlias === normalizedQuery) {
      return 2;
    }

    if (normalizedAlias.startsWith(normalizedQuery)) {
      return 3;
    }

    if (normalizedAlias.includes(normalizedQuery)) {
      return 4;
    }
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  if (
    queryTokens.length > 0 &&
    queryTokens.every(
      (token) =>
        normalizedLabel.includes(token) ||
        normalizedAliases.some((alias) => alias.includes(token))
    )
  ) {
    return 5;
  }

  return Number.POSITIVE_INFINITY;
}

export function getBlockedCallReasonSuggestions(
  reasonText,
  { limit = 8, showAllWhenEmpty = false } = {}
) {
  const normalizedQuery = normalizeReasonText(reasonText);

  if (!normalizedQuery && !showAllWhenEmpty) {
    return [];
  }

  return BLOCKED_CALL_REASON_OPTIONS.map((option, index) => ({
    index,
    option,
    score: scoreReasonOption(option, normalizedQuery),
  }))
    .filter((entry) =>
      normalizedQuery ? Number.isFinite(entry.score) : true
    )
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return left.index - right.index;
    })
    .slice(0, limit)
    .map((entry) => entry.option);
}

export function getMatchedBlockedCallReason(reasonText) {
  const normalizedQuery = normalizeReasonText(reasonText);

  if (!normalizedQuery) {
    return null;
  }

  return (
    BLOCKED_CALL_REASON_OPTIONS.find((option) =>
      getNormalizedReasonValues(option).includes(normalizedQuery)
    ) ?? null
  );
}

export function requiresBlockedCallVehiclePlate(reasonText) {
  return Boolean(getMatchedBlockedCallReason(reasonText)?.requiresVehiclePlate);
}

export function allowsMultipleBlockedCallVehiclePlates(reasonText) {
  return Boolean(
    getMatchedBlockedCallReason(reasonText)?.allowsMultipleVehiclePlates
  );
}
