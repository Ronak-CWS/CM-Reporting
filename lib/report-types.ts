export type RecordType = 'daily' | 'complaint';

export type RecordStatus = 'Open' | 'In progress' | 'Resolved';

export type RecordPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

export type BlockageScope = 'pickup' | 'street';

export interface BlockageDetails {
  scope: BlockageScope;
  reasonCode: string;
  reasonLabel: string;
  streetFrom: string;
  streetTo: string;
  notes: string;
  vehiclePlates: string;
}

export interface ReportPhoto {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  url: string;
}

export interface ReportRecord {
  id: string;
  referenceNumber: string;
  recordType: RecordType;
  occurredAt: string;
  reportedAt: string;
  registeredCommunity: string;
  siteAddress: string;
  routeNumber: string;
  serviceType: string;
  category: string;
  categoryOtherReason: string;
  priority: RecordPriority;
  status: RecordStatus;
  contactMedium: string;
  employeeName: string;
  employeeTitle: string;
  customerName: string;
  customerAddress: string;
  customerContactInformation: string;
  issueDescription: string;
  rootCause: string;
  correctiveAction: string;
  resolutionDescription: string;
  resolutionDueAt: string;
  resolvedAt: string;
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
  blockage: BlockageDetails | null;
  photos: ReportPhoto[];
}

export type CreateReportRecordInput = Omit<
  ReportRecord,
  'id' | 'referenceNumber' | 'reportedAt' | 'createdAt' | 'updatedAt' | 'photos'
>;

export interface UpdateReportRecordInput {
  id: string;
  status: RecordStatus;
  assignedTo?: string;
  correctiveAction?: string;
  resolutionDescription?: string;
  resolutionDueAt?: string;
  resolvedAt?: string;
}
