export const COMPLAINT_CATEGORIES = [
  'Missed collection',
  'Container issue',
  'Property damage',
  'Service quality',
  'Contamination or tag',
  'Driver conduct',
  'Other',
];

export const COMPLAINT_OTHER_REASON_LIMIT = 500;

export function complaintCategoryError(category: string, otherReason: string) {
  if (!COMPLAINT_CATEGORIES.includes(category)) return 'Choose an inquiry or complaint category from the list.';
  if (category !== 'Other') return '';
  if (!otherReason.trim()) return 'Explain the reason for choosing Other.';
  if (otherReason.trim().length > COMPLAINT_OTHER_REASON_LIMIT) {
    return `Keep the Other explanation to ${COMPLAINT_OTHER_REASON_LIMIT} characters or fewer.`;
  }
  return '';
}
