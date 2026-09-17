import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const reportRecords = sqliteTable(
  'report_records',
  {
    id: text('id').primaryKey(),
    referenceNumber: text('reference_number').notNull().unique(),
    recordType: text('record_type', { enum: ['daily', 'complaint'] }).notNull(),
    occurredAt: text('occurred_at').notNull(),
    reportedAt: text('reported_at').notNull(),
    registeredCommunity: text('registered_community').notNull(),
    siteAddress: text('site_address').notNull().default(''),
    routeNumber: text('route_number').notNull().default(''),
    serviceType: text('service_type').notNull().default(''),
    category: text('category').notNull(),
    priority: text('priority', {
      enum: ['Low', 'Normal', 'High', 'Urgent'],
    })
      .notNull()
      .default('Normal'),
    status: text('status', {
      enum: ['Open', 'In progress', 'Resolved'],
    })
      .notNull()
      .default('Open'),
    contactMedium: text('contact_medium').notNull().default(''),
    employeeName: text('employee_name').notNull(),
    employeeTitle: text('employee_title').notNull().default(''),
    customerName: text('customer_name').notNull().default(''),
    customerAddress: text('customer_address').notNull().default(''),
    customerContactInformation: text('customer_contact_information')
      .notNull()
      .default(''),
    issueDescription: text('issue_description').notNull(),
    rootCause: text('root_cause').notNull().default(''),
    correctiveAction: text('corrective_action').notNull().default(''),
    resolutionDescription: text('resolution_description').notNull().default(''),
    resolutionDueAt: text('resolution_due_at').notNull().default(''),
    resolvedAt: text('resolved_at').notNull().default(''),
    assignedTo: text('assigned_to').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_report_records_type_occurred').on(
      table.recordType,
      table.occurredAt,
    ),
    index('idx_report_records_status').on(table.status),
    index('idx_report_records_community').on(table.registeredCommunity),
  ],
);

export const reportBlockages = sqliteTable('report_blockages', {
  recordId: text('record_id').primaryKey().references(() => reportRecords.id),
  scope: text('scope', { enum: ['pickup', 'street'] }).notNull(),
  reasonCode: text('reason_code').notNull(),
  reasonLabel: text('reason_label').notNull(),
  streetFrom: text('street_from').notNull().default(''),
  streetTo: text('street_to').notNull().default(''),
  notes: text('notes').notNull().default(''),
  vehiclePlates: text('vehicle_plates').notNull().default(''),
  requestHash: text('request_hash').notNull(),
});

export const reportPhotos = sqliteTable('report_photos', {
  id: text('id').primaryKey(),
  recordId: text('record_id').notNull().references(() => reportRecords.id),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  position: integer('position').notNull(),
}, (table) => [index('idx_report_photos_record').on(table.recordId, table.position)]);
