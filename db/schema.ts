import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
