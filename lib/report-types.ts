export type RecordType = 'daily' | 'complaint';

export type RecordStatus = 'Open' | 'In progress' | 'Resolved';

export type RecordPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

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
}

export type CreateReportRecordInput = Omit<
  ReportRecord,
  'id' | 'referenceNumber' | 'reportedAt' | 'createdAt' | 'updatedAt'
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
