import { NextResponse } from 'next/server';
import {
  createReportRecord,
  listReportRecords,
  updateReportRecord,
} from '../../../lib/reporting-store';
import type {
  CreateReportRecordInput,
  RecordPriority,
  RecordStatus,
  RecordType,
  UpdateReportRecordInput,
} from '../../../lib/report-types';

export const dynamic = 'force-dynamic';

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecordType(value: string): value is RecordType {
  return value === 'daily' || value === 'complaint';
}

function isPriority(value: string): value is RecordPriority {
  return value === 'Low' || value === 'Normal' || value === 'High' || value === 'Urgent';
}

function isStatus(value: string): value is RecordStatus {
  return value === 'Open' || value === 'In progress' || value === 'Resolved';
}

function parseCreateInput(payload: unknown): CreateReportRecordInput {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const recordTypeValue = textValue(body.recordType);
  const priorityValue = textValue(body.priority);
  const statusValue = textValue(body.status);

  if (!isRecordType(recordTypeValue)) {
    throw new Error('Choose either a daily report or complaint record.');
  }

  const input: CreateReportRecordInput = {
    recordType: recordTypeValue,
    occurredAt: textValue(body.occurredAt),
    registeredCommunity: textValue(body.registeredCommunity),
    siteAddress: textValue(body.siteAddress),
    routeNumber: textValue(body.routeNumber),
    serviceType: textValue(body.serviceType),
    category: textValue(body.category),
    priority: isPriority(priorityValue) ? priorityValue : 'Normal',
    status: isStatus(statusValue) ? statusValue : 'Open',
    contactMedium: textValue(body.contactMedium),
    employeeName: textValue(body.employeeName),
    employeeTitle: textValue(body.employeeTitle),
    customerName: textValue(body.customerName),
    customerAddress: textValue(body.customerAddress),
    customerContactInformation: textValue(body.customerContactInformation),
    issueDescription: textValue(body.issueDescription),
    rootCause: textValue(body.rootCause),
    correctiveAction: textValue(body.correctiveAction),
    resolutionDescription: textValue(body.resolutionDescription),
    resolutionDueAt: textValue(body.resolutionDueAt),
    resolvedAt: textValue(body.resolvedAt),
    assignedTo: textValue(body.assignedTo),
  };

  const commonRequired = [
    ['Date and time', input.occurredAt],
    ['Registered community', input.registeredCommunity],
    ['Category', input.category],
    ['Employee name', input.employeeName],
    ['Description', input.issueDescription],
  ];
  const complaintRequired = [
    ['Contact medium', input.contactMedium],
    ['Employee title', input.employeeTitle],
    ['Customer name', input.customerName],
    ['Customer address', input.customerAddress],
    ['Customer contact information', input.customerContactInformation],
  ];
  const missingField = [
    ...commonRequired,
    ...(input.recordType === 'complaint' ? complaintRequired : []),
  ].find(([, value]) => !value);

  if (missingField) {
    throw new Error(`${missingField[0]} is required.`);
  }

  if (input.status === 'Resolved' && !input.resolutionDescription) {
    throw new Error('Describe the resolution before marking the record resolved.');
  }

  return input;
}

function parseUpdateInput(payload: unknown): UpdateReportRecordInput {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const id = textValue(body.id);
  const statusValue = textValue(body.status);
  const resolutionDescription = textValue(body.resolutionDescription);

  if (!id) {
    throw new Error('A report ID is required.');
  }

  if (!isStatus(statusValue)) {
    throw new Error('Choose a valid report status.');
  }

  if (statusValue === 'Resolved' && !resolutionDescription) {
    throw new Error('Describe the resolution before marking the record resolved.');
  }

  return {
    id,
    status: statusValue,
    assignedTo: textValue(body.assignedTo),
    correctiveAction: textValue(body.correctiveAction),
    resolutionDescription,
    resolutionDueAt: textValue(body.resolutionDueAt),
    resolvedAt: textValue(body.resolvedAt),
  };
}

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'The reporting request failed.';
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const records = await listReportRecords();
    return NextResponse.json({ records });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parseCreateInput(await request.json());
    const record = await createReportRecord(input);
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = parseUpdateInput(await request.json());
    const record = await updateReportRecord(input);
    return NextResponse.json({ record });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
