import type { ReportRecord } from './report-types';

export function reportDescription(record: Pick<ReportRecord, 'recordType' | 'category' | 'categoryOtherReason' | 'issueDescription'>) {
  return record.recordType === 'complaint' && record.category === 'Other' && record.categoryOtherReason
    ? `Other category reason: ${record.categoryOtherReason}\n\n${record.issueDescription}`
    : record.issueDescription;
}
