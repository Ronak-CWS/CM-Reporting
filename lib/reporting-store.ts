import { env } from 'cloudflare:workers';
import type {
  CreateReportRecordInput,
  ReportRecord,
  UpdateReportRecordInput,
} from './report-types';

type DatabaseRow = Record<string, unknown>;

let initializationPromise: Promise<void> | null = null;

const CREATE_REPORT_RECORDS_TABLE = `
  CREATE TABLE IF NOT EXISTS report_records (
    id TEXT PRIMARY KEY,
    reference_number TEXT NOT NULL UNIQUE,
    record_type TEXT NOT NULL CHECK (record_type IN ('daily', 'complaint')),
    occurred_at TEXT NOT NULL,
    reported_at TEXT NOT NULL,
    registered_community TEXT NOT NULL,
    site_address TEXT NOT NULL DEFAULT '',
    route_number TEXT NOT NULL DEFAULT '',
    service_type TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In progress', 'Resolved')),
    contact_medium TEXT NOT NULL DEFAULT '',
    employee_name TEXT NOT NULL,
    employee_title TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_address TEXT NOT NULL DEFAULT '',
    customer_contact_information TEXT NOT NULL DEFAULT '',
    issue_description TEXT NOT NULL,
    root_cause TEXT NOT NULL DEFAULT '',
    corrective_action TEXT NOT NULL DEFAULT '',
    resolution_description TEXT NOT NULL DEFAULT '',
    resolution_due_at TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    assigned_to TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

function getDatabase() {
  if (!env.DB) {
    throw new Error('The CM reporting database is not available.');
  }

  return env.DB;
}

async function initializeSchema() {
  const database = getDatabase();

  await database.batch([
    database.prepare(CREATE_REPORT_RECORDS_TABLE),
    database.prepare(
      'CREATE INDEX IF NOT EXISTS idx_report_records_type_occurred ON report_records(record_type, occurred_at)',
    ),
    database.prepare(
      'CREATE INDEX IF NOT EXISTS idx_report_records_status ON report_records(status)',
    ),
    database.prepare(
      'CREATE INDEX IF NOT EXISTS idx_report_records_community ON report_records(registered_community)',
    ),
  ]);
  await database.prepare('PRAGMA optimize').run();
}

async function ensureSchema() {
  if (!initializationPromise) {
    initializationPromise = initializeSchema().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function mapRow(row: DatabaseRow): ReportRecord {
  return {
    id: asText(row.id),
    referenceNumber: asText(row.reference_number),
    recordType: asText(row.record_type) === 'complaint' ? 'complaint' : 'daily',
    occurredAt: asText(row.occurred_at),
    reportedAt: asText(row.reported_at),
    registeredCommunity: asText(row.registered_community),
    siteAddress: asText(row.site_address),
    routeNumber: asText(row.route_number),
    serviceType: asText(row.service_type),
    category: asText(row.category),
    priority: ReportRecordPriority(asText(row.priority)),
    status: ReportRecordStatus(asText(row.status)),
    contactMedium: asText(row.contact_medium),
    employeeName: asText(row.employee_name),
    employeeTitle: asText(row.employee_title),
    customerName: asText(row.customer_name),
    customerAddress: asText(row.customer_address),
    customerContactInformation: asText(row.customer_contact_information),
    issueDescription: asText(row.issue_description),
    rootCause: asText(row.root_cause),
    correctiveAction: asText(row.corrective_action),
    resolutionDescription: asText(row.resolution_description),
    resolutionDueAt: asText(row.resolution_due_at),
    resolvedAt: asText(row.resolved_at),
    assignedTo: asText(row.assigned_to),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

function ReportRecordPriority(value: string): ReportRecord['priority'] {
  return value === 'Low' || value === 'High' || value === 'Urgent'
    ? value
    : 'Normal';
}

function ReportRecordStatus(value: string): ReportRecord['status'] {
  return value === 'In progress' || value === 'Resolved' ? value : 'Open';
}

function buildReferenceNumber(recordType: ReportRecord['recordType'], occurredAt: string) {
  const datePart = occurredAt.slice(0, 10).replaceAll('-', '') || 'UNDATED';
  const token = crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
  const typePart = recordType === 'complaint' ? 'CMP' : 'DAY';

  return `CM-${typePart}-${datePart}-${token}`;
}

export async function listReportRecords() {
  await ensureSchema();
  const result = await getDatabase()
    .prepare('SELECT * FROM report_records ORDER BY occurred_at DESC, created_at DESC LIMIT 1000')
    .all<DatabaseRow>();

  return result.results.map(mapRow);
}

export async function createReportRecord(input: CreateReportRecordInput) {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const referenceNumber = buildReferenceNumber(input.recordType, input.occurredAt);
  const resolvedAt = input.status === 'Resolved' ? input.resolvedAt || now : '';

  await database
    .prepare(
      `INSERT INTO report_records (
        id, reference_number, record_type, occurred_at, reported_at,
        registered_community, site_address, route_number, service_type,
        category, priority, status, contact_medium, employee_name,
        employee_title, customer_name, customer_address,
        customer_contact_information, issue_description, root_cause,
        corrective_action, resolution_description, resolution_due_at,
        resolved_at, assigned_to, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`,
    )
    .bind(
      id,
      referenceNumber,
      input.recordType,
      input.occurredAt,
      now,
      input.registeredCommunity,
      input.siteAddress,
      input.routeNumber,
      input.serviceType,
      input.category,
      input.priority,
      input.status,
      input.contactMedium,
      input.employeeName,
      input.employeeTitle,
      input.customerName,
      input.customerAddress,
      input.customerContactInformation,
      input.issueDescription,
      input.rootCause,
      input.correctiveAction,
      input.resolutionDescription,
      input.resolutionDueAt,
      resolvedAt,
      input.assignedTo,
      now,
      now,
    )
    .run();

  const result = await database
    .prepare('SELECT * FROM report_records WHERE id = ?')
    .bind(id)
    .first<DatabaseRow>();

  if (!result) {
    throw new Error('The report was saved but could not be reloaded.');
  }

  return mapRow(result);
}

export async function updateReportRecord(input: UpdateReportRecordInput) {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  const resolvedAt = input.status === 'Resolved' ? input.resolvedAt || now : '';

  await database
    .prepare(
      `UPDATE report_records
       SET status = ?, assigned_to = ?, corrective_action = ?,
           resolution_description = ?, resolution_due_at = ?, resolved_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.status,
      input.assignedTo ?? '',
      input.correctiveAction ?? '',
      input.resolutionDescription ?? '',
      input.resolutionDueAt ?? '',
      resolvedAt,
      now,
      input.id,
    )
    .run();

  const result = await database
    .prepare('SELECT * FROM report_records WHERE id = ?')
    .bind(input.id)
    .first<DatabaseRow>();

  if (!result) {
    throw new Error('The selected report no longer exists.');
  }

  return mapRow(result);
}
