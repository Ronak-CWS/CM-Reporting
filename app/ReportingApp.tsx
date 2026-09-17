'use client';

import Image from 'next/image';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  CreateReportRecordInput,
  ReportRecord,
  RecordStatus,
  RecordType,
  UpdateReportRecordInput,
} from '../lib/report-types';

type View = 'dashboard' | 'daily' | 'complaints' | 'exports';
type FormMode = RecordType | null;

const DAILY_CATEGORIES = [
  'Incident',
  'Blocked call',
  'Service problem',
  'Missed collection',
  'Corrective action',
  'Other',
];

const COMPLAINT_CATEGORIES = [
  'Missed collection',
  'Container issue',
  'Property damage',
  'Service quality',
  'Contamination or tag',
  'Driver conduct',
  'Other',
];

const CONTACT_MEDIA = [
  'Phone call',
  'Email',
  'Live chat',
  'Web form',
  'In person',
  'Other',
];

const SERVICE_TYPES = ['Waste', 'Recycling', 'Organics', 'Communal', 'Other'];
const STATUS_OPTIONS: RecordStatus[] = ['Open', 'In progress', 'Resolved'];

const NAV_ITEMS: Array<{ id: View; label: string; number: string }> = [
  { id: 'dashboard', label: 'Dashboard', number: '01' },
  { id: 'daily', label: 'Daily reports', number: '02' },
  { id: 'complaints', label: 'Complaints', number: '03' },
  { id: 'exports', label: 'Exports', number: '04' },
];

function edmontonParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function edmontonDateKey(date = new Date()) {
  const parts = edmontonParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function edmontonDateTimeLocal() {
  const parts = edmontonParts();
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function monthStartDateKey() {
  const parts = edmontonParts();
  return `${parts.year}-${parts.month}-01`;
}

function formatDateTime(value: string) {
  if (!value) return 'Not recorded';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace('T', ' ');
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatShortDateTime(value: string) {
  if (!value) return 'Not recorded';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace('T', ' ');
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatTodayHeading() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function resolutionTiming(record: ReportRecord) {
  if (!record.resolvedAt) return 'Not resolved';
  const start = new Date(record.occurredAt).getTime();
  const end = new Date(record.resolvedAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return formatDateTime(record.resolvedAt);
  }

  const totalMinutes = Math.round((end - start) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function statusClass(status: RecordStatus) {
  return status.toLowerCase().replaceAll(' ', '-');
}

function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The reporting request failed.';
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(payload.error || 'The reporting request failed.');
  }

  return payload;
}

function StatusPill({ status }: { status: RecordStatus }) {
  return <span className={`status-pill status-pill--${statusClass(status)}`}>{status}</span>;
}

function PriorityPill({ priority }: { priority: ReportRecord['priority'] }) {
  return (
    <span className={`priority-pill priority-pill--${priority.toLowerCase()}`}>
      {priority}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  detail: string;
  tone?: 'default' | 'accent' | 'warning' | 'positive';
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__label">{label}</span>
      <strong>{value}</strong>
      <span className={`metric-card__detail metric-card__detail--${tone}`}>
        {detail}
      </span>
    </article>
  );
}

function EmptyState({
  title,
  copy,
  actionLabel,
  onAction,
}: {
  title: string;
  copy: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark">CM</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {actionLabel && onAction ? (
        <button className="button button--primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function DashboardView({
  records,
  loading,
  onCreate,
  onOpenRecord,
  onChangeView,
}: {
  records: ReportRecord[];
  loading: boolean;
  onCreate: (mode: RecordType) => void;
  onOpenRecord: (record: ReportRecord) => void;
  onChangeView: (view: View) => void;
}) {
  const todayKey = edmontonDateKey();
  const todayRecords = records.filter((record) => record.occurredAt.slice(0, 10) === todayKey);
  const todayComplaints = todayRecords.filter((record) => record.recordType === 'complaint');
  const openActions = records.filter((record) => record.status !== 'Resolved');
  const resolvedToday = records.filter(
    (record) => record.resolvedAt.slice(0, 10) === todayKey,
  );
  const flaggedActions = openActions.filter(
    (record) => record.priority === 'High' || record.priority === 'Urgent',
  );
  const communities = new Set(todayRecords.map((record) => record.registeredCommunity));
  const recentRecords = records.slice(0, 5);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CM operations</p>
          <h1>Daily reporting overview</h1>
          <p className="page-intro">
            Log service events and complaints, follow corrective actions, and prepare
            the records Circular Materials needs.
          </p>
        </div>
        <div className="heading-actions">
          <button className="button button--secondary" type="button" onClick={() => onCreate('complaint')}>
            Log complaint
          </button>
          <button className="button button--primary" type="button" onClick={() => onCreate('daily')}>
            New daily report
          </button>
        </div>
      </div>

      <section className="metric-grid" aria-label="Today's reporting summary">
        <MetricCard
          label="Records today"
          value={todayRecords.length}
          detail={`${communities.size} registered ${communities.size === 1 ? 'community' : 'communities'}`}
          tone="accent"
        />
        <MetricCard
          label="Open actions"
          value={openActions.length}
          detail={`${flaggedActions.length} high priority`}
          tone={flaggedActions.length ? 'warning' : 'default'}
        />
        <MetricCard
          label="Complaints today"
          value={todayComplaints.length}
          detail={`${todayComplaints.filter((record) => record.status !== 'Open').length} acknowledged or resolved`}
        />
        <MetricCard
          label="Resolved today"
          value={resolvedToday.length}
          detail={resolvedToday.length ? 'Corrective actions recorded' : 'No resolutions yet'}
          tone="positive"
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live register</p>
              <h2>Recent activity</h2>
            </div>
            <button className="text-button" type="button" onClick={() => onChangeView('daily')}>
              View all records
            </button>
          </div>

          {loading ? (
            <div className="record-loading" role="status">Loading reporting records…</div>
          ) : recentRecords.length ? (
            <div className="activity-list">
              {recentRecords.map((record) => (
                <button
                  className="activity-row"
                  type="button"
                  key={record.id}
                  onClick={() => onOpenRecord(record)}
                >
                  <span className={`activity-type activity-type--${record.recordType}`}>
                    {record.recordType === 'complaint' ? 'C' : 'D'}
                  </span>
                  <span className="activity-main">
                    <strong>{record.issueDescription}</strong>
                    <small>{record.referenceNumber} · {record.registeredCommunity}</small>
                  </span>
                  <StatusPill status={record.status} />
                  <time>{formatShortDateTime(record.occurredAt)}</time>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No reporting activity yet"
              copy="Start with a daily operational report or log the first customer complaint."
              actionLabel="New daily report"
              onAction={() => onCreate('daily')}
            />
          )}
        </article>

        <aside className="panel summary-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Scheduled release</p>
              <h2>Daily summary</h2>
            </div>
            <span className={`status-pill ${flaggedActions.length ? 'status-pill--in-progress' : 'status-pill--resolved'}`}>
              {flaggedActions.length ? 'Review needed' : 'On track'}
            </span>
          </div>
          <div className="summary-time">
            <strong>5:00 PM</strong>
            <span>America/Edmonton</span>
          </div>
          <div className="summary-facts">
            <span><strong>{todayRecords.length}</strong> records today</span>
            <span><strong>{openActions.length}</strong> open actions</span>
            <span><strong>{flaggedActions.length}</strong> flagged</span>
          </div>
          <p>
            Review today&apos;s register, then download the complete daily summary for
            the dedicated CM email release.
          </p>
          <button className="button button--wide button--secondary" type="button" onClick={() => onChangeView('exports')}>
            Review daily summary
          </button>
        </aside>
      </section>
    </>
  );
}

function RegisterView({
  mode,
  records,
  search,
  statusFilter,
  onSearchChange,
  onStatusChange,
  onCreate,
  onOpenRecord,
}: {
  mode: RecordType;
  records: ReportRecord[];
  search: string;
  statusFilter: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onCreate: () => void;
  onOpenRecord: (record: ReportRecord) => void;
}) {
  const isComplaint = mode === 'complaint';
  const query = search.trim().toLowerCase();
  const filteredRecords = records.filter((record) => {
    if (record.recordType !== mode) return false;
    if (statusFilter && record.status !== statusFilter) return false;
    if (!query) return true;

    return [
      record.referenceNumber,
      record.registeredCommunity,
      record.siteAddress,
      record.routeNumber,
      record.category,
      record.issueDescription,
      record.customerName,
      record.customerContactInformation,
      record.employeeName,
      record.assignedTo,
      record.status,
    ].some((value) => value.toLowerCase().includes(query));
  });

  return (
    <>
      <div className="page-heading page-heading--register">
        <div>
          <p className="eyebrow">{isComplaint ? 'Exhibit 7 register' : 'Operations register'}</p>
          <h1>{isComplaint ? 'Complaint reporting' : 'Daily operational reporting'}</h1>
          <p className="page-intro">
            {isComplaint
              ? 'Record every inquiry and complaint with customer details, the response taken, and the date and time of resolution.'
              : 'Track incidents, blocked calls, service problems, and corrective actions as they happen.'}
          </p>
        </div>
        <button className="button button--primary" type="button" onClick={onCreate}>
          {isComplaint ? 'Log complaint' : 'New daily report'}
        </button>
      </div>

      <section className="register-toolbar" aria-label="Record filters">
        <label className="search-field">
          <span className="sr-only">Search records</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={isComplaint ? 'Search complaints, customers, or communities' : 'Search routes, events, or communities'}
          />
        </label>
        <label className="compact-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => onStatusChange(event.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <span className="record-count">{filteredRecords.length} {filteredRecords.length === 1 ? 'record' : 'records'}</span>
      </section>

      <section className="panel register-panel">
        <div className="record-table__head" aria-hidden="true">
          <span>Reference</span>
          <span>{isComplaint ? 'Customer and community' : 'Event and community'}</span>
          <span>{isComplaint ? 'Inquiry or complaint' : 'Operational detail'}</span>
          <span>{isComplaint ? 'Resolution' : 'Owner'}</span>
          <span>Status</span>
        </div>
        {filteredRecords.length ? (
          <div className="record-table">
            {filteredRecords.map((record) => (
              <button className="record-row" type="button" key={record.id} onClick={() => onOpenRecord(record)}>
                <span className="record-cell record-cell--reference">
                  <strong>{record.referenceNumber}</strong>
                  <small>{formatShortDateTime(record.occurredAt)}</small>
                </span>
                <span className="record-cell">
                  <strong>{isComplaint ? record.customerName : record.category}</strong>
                  <small>{record.registeredCommunity}</small>
                </span>
                <span className="record-cell record-cell--description">
                  <strong>{record.issueDescription}</strong>
                  <small>{isComplaint ? record.contactMedium : [record.routeNumber, record.serviceType].filter(Boolean).join(' · ') || 'No route details'}</small>
                </span>
                <span className="record-cell">
                  <strong>{isComplaint ? record.resolutionDescription || 'Pending' : record.assignedTo || 'Unassigned'}</strong>
                  <small>{isComplaint ? resolutionTiming(record) : record.correctiveAction || 'No action recorded'}</small>
                </span>
                <span className="record-cell record-cell--status">
                  <PriorityPill priority={record.priority} />
                  <StatusPill status={record.status} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title={search || statusFilter ? 'No matching records' : isComplaint ? 'No complaints logged' : 'No daily reports logged'}
            copy={search || statusFilter ? 'Adjust the search or status filter to see more records.' : isComplaint ? 'The Exhibit 7 complaint register will appear here.' : 'Daily incidents, problems, and corrective actions will appear here.'}
            actionLabel={search || statusFilter ? undefined : isComplaint ? 'Log complaint' : 'New daily report'}
            onAction={search || statusFilter ? undefined : onCreate}
          />
        )}
      </section>
    </>
  );
}

function ExportsView({ records }: { records: ReportRecord[] }) {
  const today = edmontonDateKey();
  const [dailyFrom, setDailyFrom] = useState(today);
  const [dailyTo, setDailyTo] = useState(today);
  const [complaintFrom, setComplaintFrom] = useState(monthStartDateKey());
  const [complaintTo, setComplaintTo] = useState(today);

  const dailyCount = records.filter((record) => {
    const date = record.occurredAt.slice(0, 10);
    return date >= dailyFrom && date <= dailyTo;
  }).length;
  const complaintCount = records.filter((record) => {
    const date = record.occurredAt.slice(0, 10);
    return record.recordType === 'complaint' && date >= complaintFrom && date <= complaintTo;
  }).length;

  const dailyUrl = `/api/export?type=daily&from=${encodeURIComponent(dailyFrom)}&to=${encodeURIComponent(dailyTo)}`;
  const complaintUrl = `/api/export?type=complaints&from=${encodeURIComponent(complaintFrom)}&to=${encodeURIComponent(complaintTo)}`;

  return (
    <>
      <div className="page-heading page-heading--register">
        <div>
          <p className="eyebrow">CM deliverables</p>
          <h1>Reports and exports</h1>
          <p className="page-intro">
            Prepare the daily operational summary and the Exhibit 7 complaint record
            for scheduled delivery or an on-request review.
          </p>
        </div>
      </div>

      <section className="export-grid">
        <article className="panel export-card">
          <div className="export-card__mark">D</div>
          <div>
            <p className="eyebrow">Daily summary</p>
            <h2>Operational activity export</h2>
            <p>Includes incidents, blocked calls, complaints, root causes, corrective actions, and current status.</p>
          </div>
          <div className="date-range">
            <label>
              <span>From</span>
              <input type="date" value={dailyFrom} onChange={(event) => setDailyFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={dailyTo} onChange={(event) => setDailyTo(event.target.value)} />
            </label>
          </div>
          <div className="export-card__footer">
            <span><strong>{dailyCount}</strong> records selected</span>
            <a className="button button--primary" href={dailyUrl}>Download CSV</a>
          </div>
        </article>

        <article className="panel export-card export-card--orange">
          <div className="export-card__mark">7</div>
          <div>
            <p className="eyebrow">Exhibit 7</p>
            <h2>Complaint record export</h2>
            <p>Uses the prescribed inquiry, complaint, employee, customer, resolution, and timing columns.</p>
          </div>
          <div className="date-range">
            <label>
              <span>From</span>
              <input type="date" value={complaintFrom} onChange={(event) => setComplaintFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={complaintTo} onChange={(event) => setComplaintTo(event.target.value)} />
            </label>
          </div>
          <div className="export-card__footer">
            <span><strong>{complaintCount}</strong> complaints selected</span>
            <a className="button button--primary" href={complaintUrl}>Download CSV</a>
          </div>
        </article>
      </section>

      <section className="panel delivery-panel">
        <div>
          <p className="eyebrow">Scheduled email handoff</p>
          <h2>Daily release at 5:00 PM Mountain Time</h2>
          <p>
            The report is ready for manual download now. Connect the production email
            service and dedicated CM recipient list before enabling automatic release.
          </p>
        </div>
        <span className="connection-badge">Connection required</span>
      </section>
    </>
  );
}

function Field({
  label,
  name,
  required = false,
  children,
  hint,
}: {
  label: string;
  name: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-field" htmlFor={name}>
      <span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ReportFormModal({
  mode,
  onClose,
  onSaved,
}: {
  mode: RecordType;
  onClose: () => void;
  onSaved: (record: ReportRecord) => void;
}) {
  const isComplaint = mode === 'complaint';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const value = (name: string) => String(values[name] ?? '').trim();
    const payload: CreateReportRecordInput = {
      recordType: mode,
      occurredAt: value('occurredAt'),
      registeredCommunity: value('registeredCommunity'),
      siteAddress: value('siteAddress'),
      routeNumber: value('routeNumber'),
      serviceType: value('serviceType'),
      category: value('category'),
      priority: (value('priority') || 'Normal') as CreateReportRecordInput['priority'],
      status: (value('status') || 'Open') as RecordStatus,
      contactMedium: value('contactMedium'),
      employeeName: value('employeeName'),
      employeeTitle: value('employeeTitle'),
      customerName: value('customerName'),
      customerAddress: value('customerAddress'),
      customerContactInformation: value('customerContactInformation'),
      issueDescription: value('issueDescription'),
      rootCause: value('rootCause'),
      correctiveAction: value('correctiveAction'),
      resolutionDescription: value('resolutionDescription'),
      resolutionDueAt: value('resolutionDueAt'),
      resolvedAt: value('resolvedAt'),
      assignedTo: value('assignedTo'),
    };

    try {
      const response = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await readApiResponse<{ record: ReportRecord }>(response);
      onSaved(result.record);
    } catch (submitError) {
      setError(apiErrorMessage(submitError));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-form-title">
        <header className="report-modal__header">
          <div>
            <p className="eyebrow">{isComplaint ? 'Exhibit 7 entry' : 'Daily operations'}</p>
            <h2 id="report-form-title">{isComplaint ? 'Log an inquiry or complaint' : 'Create a daily report'}</h2>
            <p>{isComplaint ? 'Capture the complete customer and resolution record.' : 'Record the event, operational context, and corrective action.'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close form">×</button>
        </header>

        <form className="report-form" onSubmit={handleSubmit}>
          {error ? <div className="form-error" role="alert">{error}</div> : null}

          <fieldset>
            <legend>{isComplaint ? 'Inquiry details' : 'Report details'}</legend>
            <div className="form-grid">
              <Field label={isComplaint ? 'Date and time of inquiry or complaint' : 'Date and time of event'} name="occurredAt" required>
                <input id="occurredAt" name="occurredAt" type="datetime-local" defaultValue={edmontonDateTimeLocal()} required />
              </Field>
              <Field label="Registered community" name="registeredCommunity" required>
                <input id="registeredCommunity" name="registeredCommunity" type="text" placeholder="Enter community" required />
              </Field>
              {isComplaint ? (
                <Field label="Contact medium" name="contactMedium" required>
                  <select id="contactMedium" name="contactMedium" defaultValue="" required>
                    <option value="" disabled>Choose contact method</option>
                    {CONTACT_MEDIA.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Event category" name="category" required>
                  <select id="category" name="category" defaultValue="" required>
                    <option value="" disabled>Choose category</option>
                    {DAILY_CATEGORIES.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Priority" name="priority" required>
                <select id="priority" name="priority" defaultValue="Normal" required>
                  {['Low', 'Normal', 'High', 'Urgent'].map((option) => <option key={option}>{option}</option>)}
                </select>
              </Field>
              {isComplaint ? (
                <Field label="Inquiry or complaint category" name="category" required>
                  <select id="category" name="category" defaultValue="" required>
                    <option value="" disabled>Choose category</option>
                    {COMPLAINT_CATEGORIES.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </Field>
              ) : null}
            </div>
          </fieldset>

          <fieldset>
            <legend>{isComplaint ? 'Employee logging the record' : 'Service context'}</legend>
            <div className="form-grid">
              {isComplaint ? (
                <>
                  <Field label="Employee name" name="employeeName" required>
                    <input id="employeeName" name="employeeName" type="text" autoComplete="name" required />
                  </Field>
                  <Field label="Employee title" name="employeeTitle" required>
                    <input id="employeeTitle" name="employeeTitle" type="text" placeholder="Customer service representative" required />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Site or service address" name="siteAddress">
                    <input id="siteAddress" name="siteAddress" type="text" placeholder="Street address or site name" />
                  </Field>
                  <Field label="Route number" name="routeNumber">
                    <input id="routeNumber" name="routeNumber" type="text" placeholder="e.g., 41103" />
                  </Field>
                  <Field label="Service type" name="serviceType">
                    <select id="serviceType" name="serviceType" defaultValue="">
                      <option value="">Choose service type</option>
                      {SERVICE_TYPES.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Logged by" name="employeeName" required>
                    <input id="employeeName" name="employeeName" type="text" autoComplete="name" required />
                  </Field>
                </>
              )}
            </div>
          </fieldset>

          {isComplaint ? (
            <fieldset>
              <legend>Person making the inquiry or complaint</legend>
              <div className="form-grid">
                <Field label="Customer name" name="customerName" required>
                  <input id="customerName" name="customerName" type="text" autoComplete="name" required />
                </Field>
                <Field label="Address" name="customerAddress" required>
                  <input id="customerAddress" name="customerAddress" type="text" autoComplete="street-address" required />
                </Field>
                <Field label="Contact information" name="customerContactInformation" required hint="Phone number, email address, or other preferred contact.">
                  <input id="customerContactInformation" name="customerContactInformation" type="text" required />
                </Field>
                <Field label="Assigned to" name="assignedTo">
                  <input id="assignedTo" name="assignedTo" type="text" placeholder="Employee or team" />
                </Field>
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend>{isComplaint ? 'Complaint and resolution' : 'Event and corrective action'}</legend>
            <div className="form-grid">
              <Field label={isComplaint ? 'Description of inquiry or complaint' : 'Incident, problem, or action description'} name="issueDescription" required>
                <textarea id="issueDescription" name="issueDescription" rows={4} required />
              </Field>
              {isComplaint ? (
                <Field label="Description of resolution" name="resolutionDescription">
                  <textarea id="resolutionDescription" name="resolutionDescription" rows={4} placeholder="Leave blank if the complaint is still open" />
                </Field>
              ) : (
                <Field label="Root cause" name="rootCause">
                  <textarea id="rootCause" name="rootCause" rows={4} />
                </Field>
              )}
              {!isComplaint ? (
                <Field label="Corrective action" name="correctiveAction">
                  <textarea id="correctiveAction" name="correctiveAction" rows={4} />
                </Field>
              ) : null}
              {!isComplaint ? (
                <Field label="Assigned to" name="assignedTo">
                  <input id="assignedTo" name="assignedTo" type="text" placeholder="Employee or team" />
                </Field>
              ) : null}
              <Field label="Status" name="status" required>
                <select id="status" name="status" defaultValue="Open" required>
                  {STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </Field>
              {isComplaint ? (
                <Field label="Date and time of resolution" name="resolvedAt">
                  <input id="resolvedAt" name="resolvedAt" type="datetime-local" />
                </Field>
              ) : (
                <Field label="Resolution due" name="resolutionDueAt">
                  <input id="resolutionDueAt" name="resolutionDueAt" type="datetime-local" />
                </Field>
              )}
            </div>
          </fieldset>

          <footer className="report-form__footer">
            <span><b>*</b> Required for the reporting record</span>
            <div>
              <button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : isComplaint ? 'Save complaint' : 'Save daily report'}</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RecordDetails({
  record,
  onClose,
  onUpdated,
}: {
  record: ReportRecord;
  onClose: () => void;
  onUpdated: (record: ReportRecord) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload: UpdateReportRecordInput = {
      id: record.id,
      status: String(values.status ?? 'Open') as RecordStatus,
      assignedTo: String(values.assignedTo ?? '').trim(),
      correctiveAction: String(values.correctiveAction ?? '').trim(),
      resolutionDescription: String(values.resolutionDescription ?? '').trim(),
      resolutionDueAt: String(values.resolutionDueAt ?? '').trim(),
      resolvedAt: String(values.resolvedAt ?? '').trim(),
    };

    try {
      const response = await fetch('/api/records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await readApiResponse<{ record: ReportRecord }>(response);
      onUpdated(result.record);
      setSaving(false);
    } catch (updateError) {
      setError(apiErrorMessage(updateError));
      setSaving(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-detail-title">
        <header className="record-drawer__header">
          <div>
            <p className="eyebrow">{record.recordType === 'complaint' ? 'Exhibit 7 complaint' : 'Daily operational record'}</p>
            <h2 id="record-detail-title">{record.referenceNumber}</h2>
            <span>{formatDateTime(record.occurredAt)}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close record">×</button>
        </header>

        <div className="record-drawer__body">
          <div className="detail-status-row">
            <PriorityPill priority={record.priority} />
            <StatusPill status={record.status} />
          </div>

          <section className="detail-section">
            <h3>Record details</h3>
            <dl className="detail-grid">
              <DetailItem label="Registered community" value={record.registeredCommunity} />
              <DetailItem label="Category" value={record.category} />
              <DetailItem label="Site address" value={record.siteAddress} />
              <DetailItem label="Route" value={record.routeNumber} />
              <DetailItem label="Service" value={record.serviceType} />
              <DetailItem label="Logged by" value={[record.employeeName, record.employeeTitle].filter(Boolean).join(' · ')} />
              <DetailItem label="Assigned to" value={record.assignedTo} />
              <DetailItem label="Resolution timing" value={resolutionTiming(record)} />
            </dl>
          </section>

          {record.recordType === 'complaint' ? (
            <section className="detail-section">
              <h3>Customer and contact</h3>
              <dl className="detail-grid">
                <DetailItem label="Contact medium" value={record.contactMedium} />
                <DetailItem label="Customer" value={record.customerName} />
                <DetailItem label="Address" value={record.customerAddress} />
                <DetailItem label="Contact information" value={record.customerContactInformation} />
              </dl>
            </section>
          ) : null}

          <section className="detail-section">
            <h3>{record.recordType === 'complaint' ? 'Inquiry or complaint' : 'Incident or problem'}</h3>
            <p className="detail-prose">{record.issueDescription}</p>
            {record.rootCause ? <><h4>Root cause</h4><p className="detail-prose">{record.rootCause}</p></> : null}
          </section>

          <form className="resolution-form" onSubmit={handleUpdate}>
            <h3>Resolution and follow-up</h3>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="form-grid form-grid--single">
              <Field label="Status" name="detail-status" required>
                <select id="detail-status" name="status" defaultValue={record.status} required>
                  {STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </Field>
              <Field label="Assigned to" name="detail-assigned">
                <input id="detail-assigned" name="assignedTo" type="text" defaultValue={record.assignedTo} />
              </Field>
              {record.recordType === 'daily' ? (
                <Field label="Corrective action" name="detail-corrective-action">
                  <textarea id="detail-corrective-action" name="correctiveAction" rows={4} defaultValue={record.correctiveAction} />
                </Field>
              ) : null}
              <Field label="Resolution description" name="detail-resolution-description">
                <textarea id="detail-resolution-description" name="resolutionDescription" rows={4} defaultValue={record.resolutionDescription} />
              </Field>
              {record.recordType === 'daily' ? (
                <Field label="Resolution due" name="detail-resolution-due">
                  <input id="detail-resolution-due" name="resolutionDueAt" type="datetime-local" defaultValue={record.resolutionDueAt} />
                </Field>
              ) : null}
              <Field label="Date and time resolved" name="detail-resolved-at">
                <input id="detail-resolved-at" name="resolvedAt" type="datetime-local" defaultValue={record.resolvedAt} />
              </Field>
            </div>
            <button className="button button--primary button--wide" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save update'}</button>
          </form>
        </div>
      </aside>
    </div>
  );
}

export default function ReportingApp() {
  const [view, setView] = useState<View>('dashboard');
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [toast, setToast] = useState('');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/records', { cache: 'no-store' });
      const result = await readApiResponse<{ records: ReportRecord[] }>(response);
      setRecords(result.records);
    } catch (error) {
      setLoadError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadRecords();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [loadRecords]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? null,
    [records, selectedRecordId],
  );

  function handleCreated(record: ReportRecord) {
    setRecords((current) => [record, ...current]);
    setFormMode(null);
    setView(record.recordType === 'complaint' ? 'complaints' : 'daily');
    setToast(`${record.referenceNumber} saved successfully.`);
  }

  function handleUpdated(record: ReportRecord) {
    setRecords((current) => current.map((item) => item.id === record.id ? record : item));
    setSelectedRecordId(record.id);
    setToast(`${record.referenceNumber} updated.`);
  }

  const viewLabel = NAV_ITEMS.find((item) => item.id === view)?.label ?? 'Dashboard';

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand-mark" type="button" onClick={() => setView('dashboard')} aria-label="CM Reporting dashboard">
          <Image
            className="brand-logo"
            src="/collective-waste-solutions.png"
            alt="Collective Waste Solutions"
            width={172}
            height={43}
            priority
          />
          <span className="brand-product">CM Reporting</span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              className={`nav-item${view === item.id ? ' nav-item--active' : ''}`}
              type="button"
              key={item.id}
              onClick={() => setView(item.id)}
            >
              <span className="nav-item__icon">{item.number}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="connection-dot" />
          Reporting system online
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewLabel}</p>
            <p className="today-label">{formatTodayHeading()}</p>
          </div>
          <button className="user-chip" type="button" aria-label="Reporting team profile">
            <span className="user-chip__avatar">CM</span>
            <span>
              <strong>Reporting team</strong>
              <small>Catchment 9</small>
            </span>
          </button>
        </header>

        <div className="content">
          {loadError ? (
            <div className="load-error" role="alert">
              <span>{loadError}</span>
              <button className="text-button" type="button" onClick={() => void loadRecords()}>Try again</button>
            </div>
          ) : null}

          {view === 'dashboard' ? (
            <DashboardView
              records={records}
              loading={loading}
              onCreate={setFormMode}
              onOpenRecord={(record) => setSelectedRecordId(record.id)}
              onChangeView={setView}
            />
          ) : null}
          {view === 'daily' ? (
            <RegisterView
              mode="daily"
              records={records}
              search={search}
              statusFilter={statusFilter}
              onSearchChange={setSearch}
              onStatusChange={setStatusFilter}
              onCreate={() => setFormMode('daily')}
              onOpenRecord={(record) => setSelectedRecordId(record.id)}
            />
          ) : null}
          {view === 'complaints' ? (
            <RegisterView
              mode="complaint"
              records={records}
              search={search}
              statusFilter={statusFilter}
              onSearchChange={setSearch}
              onStatusChange={setStatusFilter}
              onCreate={() => setFormMode('complaint')}
              onOpenRecord={(record) => setSelectedRecordId(record.id)}
            />
          ) : null}
          {view === 'exports' ? <ExportsView records={records} /> : null}
        </div>
      </section>

      {formMode ? <ReportFormModal mode={formMode} onClose={() => setFormMode(null)} onSaved={handleCreated} /> : null}
      {selectedRecord ? <RecordDetails record={selectedRecord} onClose={() => setSelectedRecordId('')} onUpdated={handleUpdated} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
