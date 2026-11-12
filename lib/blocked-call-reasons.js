export const BLOCKED_CALL_REASON_OPTIONS = [
  {
    code: 'bin_spacing',
    label: 'Bin spacing',
    description: 'Use this when bins are placed too close together or too close to nearby objects for the truck to lift and empty them safely.',
    aliases: ['spacing', 'too close', 'bins too close together', 'not enough clearance'],
  },
  {
    code: 'obstruction',
    label: 'Obstruction',
    description: 'Use this when a vehicle, fence, locked gate, snowbank, construction material, or another obstacle blocks access to the bin or street.',
    aliases: ['vehicle', 'car', 'truck', 'van', 'fence', 'gate', 'snow', 'ice', 'construction', 'debris', 'road closed', 'flooding', 'crash'],
    allowsVehiclePlates: true,
  },
  {
    code: 'bins_not_out',
    label: 'Bin not out',
    description: 'Use this when the bin is not at its designated collection point when you arrive, such as a bin still in a garage or yard.',
    aliases: ['bin not out', 'bins not out', 'cart not out', 'missing bin', 'not set out'],
  },
  {
    code: 'oops_tag',
    label: 'OOPs',
    description: 'Use this when you leave an OOPs tag to explain a problem with the bin or its contents, such as unacceptable materials or items prepared incorrectly. Add the tag details if available.',
    aliases: ['oops', 'oops tag', 'tagged bin', 'tagged cart', 'contamination', 'unacceptable materials'],
  },
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
