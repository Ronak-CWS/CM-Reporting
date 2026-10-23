import { getDatabase, getPhotoStorage, type StorageDatabase } from './local-storage';
import { appPath } from './app-path.js';
import { InputError } from './input-error';
import { EVIDENCE_SCHEMA_SQL } from './evidence-schema';
import { EMAIL_OUTBOX_SQL } from './email-outbox.js';
import { reportEmailStatements } from './report-email';
import { createHash } from 'node:crypto';
import { RECORD_PAGE_SIZE, type ReportFilters, type ReportPage, type ReportingOverview } from './report-filters';
import type { SQLInputValue } from 'node:sqlite';
import type { ValidatedPhoto } from './photo-validation';
import { edmontonDateKey, edmontonTimestamp } from './report-time';
import type {
  CreateReportRecordInput,
  ReportRecord,
  UpdateReportRecordInput,
  ReportPhoto,
} from './report-types';

type DatabaseRow = Record<string, unknown>;

const schemaInitializations = new WeakMap<StorageDatabase, Promise<void>>();

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

async function initializeSchema(database: StorageDatabase) {

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
    database.prepare('CREATE INDEX IF NOT EXISTS idx_report_records_page ON report_records(occurred_at DESC, created_at DESC, id DESC)'),
    database.prepare('CREATE INDEX IF NOT EXISTS idx_report_records_type_page ON report_records(record_type, occurred_at DESC, created_at DESC, id DESC)'),
    ...EVIDENCE_SCHEMA_SQL.map((sql) => database.prepare(sql)),
    database.prepare(`CREATE TABLE IF NOT EXISTS report_complaint_details (
      record_id TEXT PRIMARY KEY NOT NULL REFERENCES report_records(id),
      category_other_reason TEXT NOT NULL DEFAULT ''
    )`),
    database.prepare(EMAIL_OUTBOX_SQL),
  ]);
  await database.prepare('PRAGMA optimize').run();
}

async function ensureSchema() {
  const database = getDatabase();
  if (!schemaInitializations.has(database)) {
    schemaInitializations.set(database, initializeSchema(database).catch((error) => {
      schemaInitializations.delete(database);
      throw error;
    }));
  }
  await schemaInitializations.get(database);
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
    categoryOtherReason: '',
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
    blockage: null,
    photos: [],
  };
}

function mapPhoto(row: DatabaseRow): ReportPhoto {
  return {
    id: asText(row.id), fileName: asText(row.file_name),
    contentType: asText(row.content_type), size: Number(row.size),
    url: appPath(`/api/records/${row.record_id}/photos/${row.id}`),
  };
}

async function attachEvidence(records: ReportRecord[]) {
  const database = getDatabase();
  const byId = new Map(records.map((record) => [record.id, record]));
  // Keep each metadata query bounded when hydrating the register.
  for (let offset = 0; offset < records.length; offset += 80) {
    const ids = records.slice(offset, offset + 80).map((record) => record.id);
    const placeholders = ids.map(() => '?').join(',');
    const [blockages, photos, complaints] = await database.batch<DatabaseRow>([
      database.prepare(`SELECT * FROM report_blockages WHERE record_id IN (${placeholders})`).bind(...ids),
      database.prepare(`SELECT * FROM report_photos WHERE record_id IN (${placeholders}) ORDER BY position`).bind(...ids),
      database.prepare(`SELECT * FROM report_complaint_details WHERE record_id IN (${placeholders})`).bind(...ids),
    ]);
    for (const row of blockages.results) {
      const record = byId.get(asText(row.record_id));
      if (record) record.blockage = {
        scope: row.scope === 'street' ? 'street' : 'pickup',
        reasonCode: asText(row.reason_code), reasonLabel: asText(row.reason_label),
        streetFrom: asText(row.street_from), streetTo: asText(row.street_to),
        notes: asText(row.notes), vehiclePlates: asText(row.vehicle_plates),
      };
    }
    for (const row of photos.results) byId.get(asText(row.record_id))?.photos.push(mapPhoto(row));
    for (const row of complaints.results) {
      const record = byId.get(asText(row.record_id));
      if (record) record.categoryOtherReason = asText(row.category_other_reason);
    }
  }
  return records;
}

async function existingSubmission(id: string, hash: string) {
  const row = await getDatabase().prepare(
    'SELECT report_records.*, report_blockages.request_hash FROM report_records LEFT JOIN report_blockages ON report_blockages.record_id = report_records.id WHERE report_records.id = ?',
  ).bind(id).first<DatabaseRow>();
  if (!row) return null;
  if (row.request_hash !== hash) throw new InputError('This submission was already saved with different details. Start a new report.', 409);
  return (await attachEvidence([mapRow(row)]))[0];
}

async function submissionHash(input: CreateReportRecordInput, photos: ValidatedPhoto[]) {
  const photoHashes = [];
  for (const photo of photos) {
    const hash = await crypto.subtle.digest('SHA-256', photo.bytes);
    photoHashes.push({ name: photo.fileName, hash: Array.from(new Uint8Array(hash)) });
  }
  // The receive time changes on a retry; the driver's content does not.
  // Complaint-only fields must not change hashes for blocked calls saved before this field existed.
  const encoded = new TextEncoder().encode(JSON.stringify({ ...input, categoryOtherReason: undefined, occurredAt: '', photos: photoHashes }));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readReportPhoto(recordId: string, photoId: string) {
  await ensureSchema();
  const row = await getDatabase().prepare(
    'SELECT * FROM report_photos WHERE record_id = ? AND id = ?',
  ).bind(recordId, photoId).first<DatabaseRow>();
  if (!row) return null;
  const object = await getPhotoStorage().get(asText(row.storage_key));
  return object ? { object, photo: mapPhoto(row) } : null;
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

function recordWhere(filters: ReportFilters) {
  const conditions = ['1 = 1'];
  const values: SQLInputValue[] = [];
  for (const [column, value] of [
    ['record_type', filters.type], ['status', filters.status], ['priority', filters.priority],
  ]) {
    if (value) { conditions.push(`r.${column} = ?`); values.push(value); }
  }
  // Stored report dates are Mountain local dates, with or without an explicit offset.
  if (filters.from) { conditions.push('r.occurred_at >= ?'); values.push(filters.from); }
  if (filters.to) { conditions.push("r.occurred_at < date(?, '+1 day')"); values.push(filters.to); }
  if (filters.search) {
    const columns = ['reference_number', 'registered_community', 'site_address', 'customer_address',
      'route_number', 'category', 'issue_description', 'customer_name', 'customer_contact_information',
      'employee_name', 'assigned_to', 'status', 'resolution_description'];
    const matches = columns.map((column) => `instr(lower(r.${column}), lower(?)) > 0`);
    values.push(...columns.map(() => filters.search!));
    matches.push(`EXISTS (SELECT 1 FROM report_blockages b WHERE b.record_id = r.id AND
      instr(lower(b.reason_label || ' ' || b.street_from || ' ' || b.street_to || ' ' || b.vehicle_plates), lower(?)) > 0)`);
    matches.push(`EXISTS (SELECT 1 FROM report_complaint_details c WHERE c.record_id = r.id AND instr(lower(c.category_other_reason), lower(?)) > 0)`);
    values.push(filters.search, filters.search);
    conditions.push(`(${matches.join(' OR ')})`);
  }
  return { sql: conditions.join(' AND '), values };
}

const recordOrder = 'r.occurred_at DESC, r.created_at DESC, r.id DESC';
const filterKey = (filters: ReportFilters) => createHash('sha256').update(JSON.stringify(filters)).digest('hex');

function readCursor(cursor: string, filters: ReportFilters): string[] {
  try {
    if (cursor.length > 1500 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.v !== 1 || value.filter !== filterKey(filters) || !Array.isArray(value.after) || value.after.length !== 3 ||
        !value.after.every((part: unknown) => typeof part === 'string' && part.length > 0 && part.length <= 100)) throw new Error();
    return value.after;
  } catch { throw new InputError('The record list has changed. Refresh the list and try again.'); }
}

export async function queryReportRecords(filters: ReportFilters, cursor = ''): Promise<ReportPage> {
  const after = cursor ? readCursor(cursor, filters) : null;
  await ensureSchema();
  const database = getDatabase();
  const where = recordWhere(filters);
  const pageValues = [...where.values, ...(after || []), RECORD_PAGE_SIZE + 1];
  const [count, page] = await database.batch<DatabaseRow>([
    database.prepare(`SELECT count(*) AS total FROM report_records r WHERE ${where.sql}`).bind(...where.values),
    database.prepare(`SELECT r.* FROM report_records r WHERE ${where.sql}
      ${after ? 'AND (r.occurred_at, r.created_at, r.id) < (?, ?, ?)' : ''}
      ORDER BY ${recordOrder} LIMIT ?`).bind(...pageValues),
  ]);
  const records = await attachEvidence(page.results.slice(0, RECORD_PAGE_SIZE).map(mapRow));
  const last = records.at(-1);
  const nextCursor = page.results.length > RECORD_PAGE_SIZE && last ? Buffer.from(JSON.stringify({
    v: 1, filter: filterKey(filters), after: [last.occurredAt, last.createdAt, last.id],
  })).toString('base64url') : null;
  return { records, total: Number(count.results[0].total), nextCursor };
}

// Downloads include every matching record, independently of the register's page size.
export async function listReportRecords(filters: ReportFilters = {}) {
  await ensureSchema();
  const where = recordWhere(filters);
  const result = await getDatabase()
    .prepare(`SELECT r.* FROM report_records r WHERE ${where.sql} ORDER BY ${recordOrder}`).bind(...where.values)
    .all<DatabaseRow>();

  return attachEvidence(result.results.map(mapRow));
}

export async function reportingOverview() {
  await ensureSchema();
  const today = edmontonDateKey();
  const [counts, recent] = await getDatabase().batch<DatabaseRow>([
    getDatabase().prepare(`SELECT
      count(CASE WHEN substr(occurred_at, 1, 10) = ?1 THEN 1 END) AS todayRecords,
      count(DISTINCT CASE WHEN substr(occurred_at, 1, 10) = ?1 THEN registered_community END) AS todayCommunities,
      count(CASE WHEN status != 'Resolved' THEN 1 END) AS openActions,
      count(CASE WHEN status != 'Resolved' AND priority IN ('High', 'Urgent') THEN 1 END) AS flaggedActions,
      count(CASE WHEN record_type = 'complaint' AND substr(occurred_at, 1, 10) = ?1 THEN 1 END) AS todayComplaints,
      count(CASE WHEN record_type = 'complaint' AND substr(occurred_at, 1, 10) = ?1 AND status != 'Open' THEN 1 END) AS acknowledgedComplaints,
      count(CASE WHEN substr(resolved_at, 1, 10) = ?1 THEN 1 END) AS resolvedToday
      FROM report_records`).bind(today),
    getDatabase().prepare(`SELECT r.* FROM report_records r ORDER BY ${recordOrder} LIMIT 5`),
  ]);
  return { overview: counts.results[0] as unknown as ReportingOverview, records: await attachEvidence(recent.results.map(mapRow)) };
}

export async function createReportRecord(input: CreateReportRecordInput, photos: ValidatedPhoto[] = [], submissionId?: string) {
  await ensureSchema();
  const database = getDatabase();
  const photoStorage = getPhotoStorage();
  const now = new Date().toISOString();
  const id = submissionId || crypto.randomUUID();
  if (input.recordType === 'daily' && (!input.blockage || !photos.length)) {
    throw new InputError('A blocked call needs a location, reason, and at least one photo.');
  }
  const requestHash = input.blockage ? await submissionHash(input, photos) : '';
  if (submissionId) {
    const existing = await existingSubmission(id, requestHash);
    if (existing) return existing;
  }
  const referenceNumber = buildReferenceNumber(input.recordType, input.occurredAt);
  const resolvedAt = input.status === 'Resolved' ? input.resolvedAt || edmontonTimestamp() : '';
  const storedPhotos: Array<ReportPhoto & { storageKey: string }> = [];
  const attemptedKeys: string[] = [];

  const statements = [database
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
    )];
  if (input.blockage) {
    const b = input.blockage;
    statements.push(database.prepare(
      `INSERT INTO report_blockages (record_id, scope, reason_code, reason_label, street_from, street_to, notes, vehicle_plates, request_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, b.scope, b.reasonCode, b.reasonLabel, b.streetFrom, b.streetTo, b.notes, b.vehiclePlates, requestHash));
  }
  if (input.recordType === 'complaint') {
    statements.push(database.prepare(
      'INSERT INTO report_complaint_details (record_id, category_other_reason) VALUES (?, ?)',
    ).bind(id, input.categoryOtherReason));
  }
  // Queue email in the same transaction as the report. No SMTP calls occur in submission requests.
  statements.push(...reportEmailStatements(database, input, id, referenceNumber, photos.length));

  try {
    for (const [position, photo] of photos.entries()) {
      const photoId = crypto.randomUUID();
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[photo.contentType];
      if (!extension) throw new Error('Unsupported photo content type.');
      const storageKey = `reports/${id}/${photoId}.${extension}`;
      attemptedKeys.push(storageKey);
      await photoStorage.put(storageKey, photo.bytes, { httpMetadata: { contentType: photo.contentType } });
      storedPhotos.push({ id: photoId, fileName: photo.fileName, contentType: photo.contentType,
        size: photo.bytes.byteLength, url: appPath(`/api/records/${id}/photos/${photoId}`), storageKey });
      statements.push(database.prepare(
        'INSERT INTO report_photos (id, record_id, storage_key, file_name, content_type, size, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(photoId, id, storageKey, photo.fileName, photo.contentType, photo.bytes.byteLength, position));
    }
    // All metadata commits together, only after every photo has been stored.
    await database.batch(statements);
  } catch (error) {
    // A lost DB response may still mean the complete submission committed.
    if (submissionId) {
      let committed;
      try { committed = await existingSubmission(id, requestHash); }
      catch (verificationError) {
        // Never remove photos if a database outage makes the commit uncertain.
        // A retry with the same submission ID will recover a committed report.
        if (!(verificationError instanceof InputError)) throw error;
        if (attemptedKeys.length) await photoStorage.delete(attemptedKeys).catch(() => console.error('Could not remove conflicting retry photos.'));
        throw verificationError;
      }
      if (committed) {
        const savedPhotoIds = new Set(committed.photos.map((photo) => photo.id));
        const unusedKeys = storedPhotos.filter((photo) => !savedPhotoIds.has(photo.id)).map((photo) => photo.storageKey);
        if (unusedKeys.length) await photoStorage.delete(unusedKeys).catch(() => console.error('Could not remove unused retry photos.'));
        return committed;
      }
    }
    if (attemptedKeys.length) await photoStorage.delete(attemptedKeys).catch(() => console.error('Could not remove incomplete upload photos.'));
    throw error;
  }

  return { ...input, id, referenceNumber, reportedAt: now, createdAt: now, updatedAt: now,
    resolvedAt, photos: storedPhotos.map(({ id: photoId, fileName, contentType, size, url }) => ({ id: photoId, fileName, contentType, size, url })) };
}

export async function updateReportRecord(input: UpdateReportRecordInput) {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  const resolvedAt = input.status === 'Resolved' ? input.resolvedAt || edmontonTimestamp() : '';

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

  return (await attachEvidence([mapRow(result)]))[0];
}
