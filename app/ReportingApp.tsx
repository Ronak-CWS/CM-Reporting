'use client';

import Image from 'next/image';
import { appPath } from '../lib/app-path.js';
import { reportingFetch } from '../lib/reporting-fetch';
import type { SignedInUser } from '../lib/auth-store';
import BlockedCallWizard from './components/BlockedCallWizard';
import LocationAutocomplete from './components/LocationAutocomplete';
import ReportPhotoPreview from './components/ReportPhotoPreview';
import AppIcon, { type AppIconName } from './components/AppIcon';
import { exportDateRangeError } from '../lib/export-date-range';
import { blockageScopeLabel } from '../lib/blocked-call-options';
import { COMPLAINT_CATEGORIES, COMPLAINT_OTHER_REASON_LIMIT, complaintCategoryError } from '../lib/complaint-options';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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

const CONTACT_MEDIA = [
  'Phone call',
  'Email',
  'Live chat',
  'Web form',
  'In person',
  'Other',
];

const STATUS_OPTIONS: RecordStatus[] = ['Open', 'In progress', 'Resolved'];

const NAV_ITEMS: Array<{ id: View; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'daily', label: 'Daily reports' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'exports', label: 'Exports' },
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
  icon,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: AppIconName;
  tone?: 'default' | 'accent' | 'warning' | 'positive' | 'complaint';
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__heading">
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__icon"><AppIcon name={icon} size={20} /></span>
      </div>
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
            Log blocked calls and complaints, follow corrective actions, and prepare
            the records Circular Materials needs.
          </p>
        </div>
        <div className="heading-actions">
          <button className="button button--secondary" type="button" onClick={() => onCreate('complaint')}>
            Log complaint
          </button>
          <button className="button button--primary" type="button" onClick={() => onCreate('daily')}>
            Report blocked call
          </button>
        </div>
      </div>

      <section className="metric-grid" aria-label="Today's reporting summary">
        <MetricCard
          label="Records today"
          icon="daily"
          value={todayRecords.length}
          detail={`${communities.size} registered ${communities.size === 1 ? 'community' : 'communities'}`}
          tone="accent"
        />
        <MetricCard
          label="Open actions"
          icon="clock"
          value={openActions.length}
          detail={`${flaggedActions.length} high priority`}
          tone={flaggedActions.length ? 'warning' : 'default'}
        />
        <MetricCard
          label="Complaints today"
          icon="complaints"
          value={todayComplaints.length}
          detail={`${todayComplaints.filter((record) => record.status !== 'Open').length} acknowledged or resolved`}
          tone="complaint"
        />
        <MetricCard
          label="Resolved today"
          icon="check"
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
                    <AppIcon name={record.recordType === 'complaint' ? 'complaints' : 'daily'} size={20} />
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
              copy="Report a blocked pickup or street, or log a customer complaint."
              actionLabel="Report blocked call"
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
      record.blockage?.reasonLabel || '',
      record.blockage?.streetFrom || '',
      record.blockage?.streetTo || '',
      record.blockage?.vehiclePlates || '',
    ].some((value) => value.toLowerCase().includes(query));
  });

  return (
    <>
      <div className="page-heading page-heading--register">
        <div>
          <p className="eyebrow">{isComplaint ? 'Exhibit 7 register' : 'Operations register'}</p>
          <h1>{isComplaint ? 'Complaint reporting' : 'Daily reporting'}</h1>
          <p className="page-intro">
            {isComplaint
              ? 'Record every inquiry and complaint with customer details, the response taken, and the date and time of resolution.'
              : 'Pickup or street blocked? Add the location, choose a reason, and take a photo.'}
          </p>
        </div>
        <button className="button button--primary" type="button" onClick={onCreate}>
          {isComplaint ? 'Log complaint' : 'Report blocked call'}
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
                  <strong>{isComplaint ? record.customerName : record.blockage ? blockageScopeLabel(record.blockage.scope) : record.category}</strong>
                  <small>{record.registeredCommunity}</small>
                </span>
                <span className="record-cell record-cell--description">
                  <strong>{record.issueDescription}</strong>
                  <small>{isComplaint ? record.contactMedium : [record.siteAddress, record.photos?.length ? `${record.photos.length} photos` : ''].filter(Boolean).join(' · ') || 'No location details'}</small>
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
            copy={search || statusFilter ? 'Adjust the search or status filter to see more records.' : isComplaint ? 'The Exhibit 7 complaint register will appear here.' : 'Blocked pickups and street blocks will appear here with their reasons and photos.'}
            actionLabel={search || statusFilter ? undefined : isComplaint ? 'Log complaint' : 'Report blocked call'}
            onAction={search || statusFilter ? undefined : onCreate}
          />
        )}
      </section>
    </>
  );
}

function ExportsView({ records, notificationsEnabled }: { records: ReportRecord[]; notificationsEnabled: boolean }) {
  const today = edmontonDateKey();
  const [dailyFrom, setDailyFrom] = useState(today);
  const [dailyTo, setDailyTo] = useState(today);
  const [complaintFrom, setComplaintFrom] = useState(monthStartDateKey());
  const [complaintTo, setComplaintTo] = useState(today);
  const dailyError = exportDateRangeError(dailyFrom, dailyTo, true);
  const complaintError = exportDateRangeError(complaintFrom, complaintTo, true);

  const dailyCount = records.filter((record) => {
    const date = record.occurredAt.slice(0, 10);
    return date >= dailyFrom && date <= dailyTo;
  }).length;
  const complaintCount = records.filter((record) => {
    const date = record.occurredAt.slice(0, 10);
    return record.recordType === 'complaint' && date >= complaintFrom && date <= complaintTo;
  }).length;

  const dailyUrl = appPath(`/api/export?type=daily&from=${encodeURIComponent(dailyFrom)}&to=${encodeURIComponent(dailyTo)}`);
  const complaintUrl = appPath(`/api/export?type=complaints&from=${encodeURIComponent(complaintFrom)}&to=${encodeURIComponent(complaintTo)}`);

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
            <p>Includes blocked pickups, street blocks, reasons, photo references, complaints, corrective actions, and current status.</p>
          </div>
          <div className="date-range">
            <label>
              <span>From</span>
              <input type="date" value={dailyFrom} max={dailyTo || undefined} required aria-invalid={Boolean(dailyError)} aria-describedby={dailyError ? 'daily-date-error' : undefined} onChange={(event) => setDailyFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={dailyTo} min={dailyFrom || undefined} required aria-invalid={Boolean(dailyError)} aria-describedby={dailyError ? 'daily-date-error' : undefined} onChange={(event) => setDailyTo(event.target.value)} />
            </label>
          </div>
          {dailyError ? <p id="daily-date-error" className="date-range-error" role="alert">{dailyError}</p> : null}
          <div className="export-card__footer">
            <span>{dailyError ? 'Choose a valid date range' : <><strong>{dailyCount}</strong> records selected</>}</span>
            {dailyError ? <button className="button button--primary" type="button" disabled>Download CSV</button> : <a className="button button--primary" href={dailyUrl}>Download CSV</a>}
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
              <input type="date" value={complaintFrom} max={complaintTo || undefined} required aria-invalid={Boolean(complaintError)} aria-describedby={complaintError ? 'complaint-date-error' : undefined} onChange={(event) => setComplaintFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={complaintTo} min={complaintFrom || undefined} required aria-invalid={Boolean(complaintError)} aria-describedby={complaintError ? 'complaint-date-error' : undefined} onChange={(event) => setComplaintTo(event.target.value)} />
            </label>
          </div>
          {complaintError ? <p id="complaint-date-error" className="date-range-error" role="alert">{complaintError}</p> : null}
          <div className="export-card__footer">
            <span>{complaintError ? 'Choose a valid date range' : <><strong>{complaintCount}</strong> complaints selected</>}</span>
            {complaintError ? <button className="button button--primary" type="button" disabled>Download CSV</button> : <a className="button button--primary" href={complaintUrl}>Download CSV</a>}
          </div>
        </article>
      </section>

      <section className="panel delivery-panel">
        <div>
          <p className="eyebrow">Report notifications</p>
          <h2>Email updates after submission</h2>
          <p>
            {notificationsEnabled
              ? 'New blocked-call reports and complaints are queued for email to the reporting team. Download CSV exports above when needed.'
              : 'Email notifications are not enabled yet. Reports are saved in the dashboard, and CSV exports are available above.'}
          </p>
        </div>
        <span className="connection-badge">{notificationsEnabled ? 'Notifications enabled' : 'Notifications not enabled'}</span>
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
  fullWidth = false,
}: {
  label: string;
  name: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  fullWidth?: boolean;
}) {
  return (
    <label className={`form-field${fullWidth ? ' form-field--full' : ''}`} htmlFor={name}>
      <span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ComplaintFormModal({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: (record: ReportRecord) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [community, setCommunity] = useState('');
  const [communitySelected, setCommunitySelected] = useState(false);
  const [category, setCategory] = useState('');
  const [categoryOtherReason, setCategoryOtherReason] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, saving]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!communitySelected) {
      setError('Choose a registered community from the service list.');
      return;
    }
    const categoryError = complaintCategoryError(category, categoryOtherReason);
    if (categoryError) {
      setError(categoryError);
      return;
    }
    setSaving(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const value = (name: string) => String(values[name] ?? '').trim();
    const payload: CreateReportRecordInput = {
      recordType: 'complaint', occurredAt: value('occurredAt'),
      registeredCommunity: community, siteAddress: '', routeNumber: '', serviceType: '',
      category, categoryOtherReason: category === 'Other' ? categoryOtherReason.trim() : '',
      priority: (value('priority') || 'Normal') as CreateReportRecordInput['priority'],
      status: (value('status') || 'Open') as RecordStatus,
      contactMedium: value('contactMedium'), employeeName: value('employeeName'),
      employeeTitle: value('employeeTitle'), customerName: value('customerName'),
      customerAddress: value('customerAddress'), customerContactInformation: value('customerContactInformation'),
      issueDescription: value('issueDescription'), rootCause: '', correctiveAction: '',
      resolutionDescription: value('resolutionDescription'), resolutionDueAt: '',
      resolvedAt: value('resolvedAt'), assignedTo: value('assignedTo'), blockage: null,
    };
    try {
      const response = await reportingFetch(appPath('/api/records'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
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
      if (event.currentTarget === event.target && !saving) onClose();
    }}>
      <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-form-title">
        <header className="report-modal__header">
          <div><p className="eyebrow">Exhibit 7 entry</p><h2 id="report-form-title">Log an inquiry or complaint</h2><p>Capture the complete customer and resolution record.</p></div>
          <button className="icon-button" type="button" disabled={saving} onClick={onClose} aria-label="Close form">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <form className="report-form" onSubmit={handleSubmit}>
          <div className="report-form__body">
            {error ? <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{error}</div> : null}
            <fieldset disabled={saving}>
              <legend><span className="form-section-number" aria-hidden="true">1</span>Inquiry details</legend>
              <div className="form-grid">
                <Field label="Date and time of inquiry or complaint" name="occurredAt" required><input id="occurredAt" name="occurredAt" type="datetime-local" defaultValue={edmontonDateTimeLocal()} required /></Field>
                <div className="form-field">
                  <LocationAutocomplete id="registeredCommunity" label="Registered community" kind="community"
                    value={community} selected={communitySelected} showRequired disabled={saving} placeholder="Start typing a community"
                    onChange={(value, selected) => { setCommunity(value); setCommunitySelected(selected); }} />
                </div>
                <Field label="Contact medium" name="contactMedium" required><select id="contactMedium" name="contactMedium" defaultValue="" required><option value="" disabled>Choose contact method</option>{CONTACT_MEDIA.map((option) => <option key={option}>{option}</option>)}</select></Field>
                <Field label="Priority" name="priority" required><select id="priority" name="priority" defaultValue="Normal" required>{['Low', 'Normal', 'High', 'Urgent'].map((option) => <option key={option}>{option}</option>)}</select></Field>
                <Field label="Inquiry or complaint category" name="category" required fullWidth><select id="category" name="category" value={category} onChange={(event) => { setCategory(event.target.value); setCategoryOtherReason(''); }} required><option value="" disabled>Choose category</option>{COMPLAINT_CATEGORIES.map((option) => <option key={option}>{option}</option>)}</select></Field>
                {category === 'Other' ? <Field label="Explain the other reason" name="categoryOtherReason" required fullWidth hint={`Explain why this inquiry or complaint does not fit the listed categories. Maximum ${COMPLAINT_OTHER_REASON_LIMIT} characters.`}>
                  <textarea id="categoryOtherReason" name="categoryOtherReason" rows={3} required maxLength={COMPLAINT_OTHER_REASON_LIMIT} value={categoryOtherReason} onChange={(event) => setCategoryOtherReason(event.target.value)} />
                </Field> : null}
              </div>
            </fieldset>
            <fieldset disabled={saving}>
              <legend><span className="form-section-number" aria-hidden="true">2</span>Employee logging the record</legend>
              <div className="form-grid">
                <Field label="Employee name" name="employeeName" required><input id="employeeName" name="employeeName" type="text" autoComplete="name" required /></Field>
                <Field label="Employee title" name="employeeTitle" required><input id="employeeTitle" name="employeeTitle" type="text" placeholder="Customer service representative" required /></Field>
              </div>
            </fieldset>
            <fieldset disabled={saving}>
              <legend><span className="form-section-number" aria-hidden="true">3</span>Person making the inquiry or complaint</legend>
              <div className="form-grid">
                <Field label="Customer name" name="customerName" required><input id="customerName" name="customerName" type="text" required /></Field>
                <Field label="Address" name="customerAddress" required><input id="customerAddress" name="customerAddress" type="text" autoComplete="street-address" required /></Field>
                <Field label="Contact information" name="customerContactInformation" required hint="Phone number, email address, or other preferred contact."><input id="customerContactInformation" name="customerContactInformation" type="text" required /></Field>
                <Field label="Assigned to" name="assignedTo"><input id="assignedTo" name="assignedTo" type="text" placeholder="Employee or team" /></Field>
              </div>
            </fieldset>
            <fieldset disabled={saving}>
              <legend><span className="form-section-number" aria-hidden="true">4</span>Complaint and resolution</legend>
              <div className="form-grid">
                <Field label="Description of inquiry or complaint" name="issueDescription" required><textarea id="issueDescription" name="issueDescription" rows={4} required /></Field>
                <Field label="Description of resolution" name="resolutionDescription"><textarea id="resolutionDescription" name="resolutionDescription" rows={4} placeholder="Leave blank if the complaint is still open" /></Field>
                <Field label="Status" name="status" required><select id="status" name="status" defaultValue="Open" required>{STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></Field>
                <Field label="Date and time of resolution" name="resolvedAt"><input id="resolvedAt" name="resolvedAt" type="datetime-local" /></Field>
              </div>
            </fieldset>
          </div>
          <footer className="report-form__footer">
            <span><b>*</b> Required fields</span>
            <div><button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save complaint'}</button></div>
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
      const response = await reportingFetch(appPath('/api/records'), {
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
              <DetailItem label="Other category reason" value={record.categoryOtherReason} />
              <DetailItem label="Blockage" value={record.blockage && blockageScopeLabel(record.blockage.scope)} />
              <DetailItem label="Blocked-call reason" value={record.blockage?.reasonLabel} />
              <DetailItem label="Street section from" value={record.blockage?.streetFrom} />
              <DetailItem label="Street section to" value={record.blockage?.streetTo} />
              <DetailItem label="Vehicle plates" value={record.blockage?.vehiclePlates} />
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
            <h3>{record.recordType === 'complaint' ? 'Inquiry or complaint' : 'Blocked call details'}</h3>
            <p className="detail-prose">{record.issueDescription}</p>
            {record.rootCause ? <><h4>Root cause</h4><p className="detail-prose">{record.rootCause}</p></> : null}
          </section>

          {record.photos?.length ? (
            <section className="detail-section">
              <h3>Photo evidence ({record.photos.length})</h3>
              <div className="saved-photo-grid">
                {record.photos.map((photo, index) => (
                  <figure key={photo.id}>
                    <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Open blockage photo ${index + 1}`}>
                      <ReportPhotoPreview src={photo.url} name={`Blockage photo ${index + 1}`} />
                    </a>
                    <figcaption>{photo.fileName}</figcaption>
                    <a className="text-button" href={`${photo.url}?download=1`}>Download photo</a>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}

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

export default function ReportingApp({ user = null, notificationsEnabled = false }: { user?: SignedInUser | null; notificationsEnabled?: boolean }) {
  const [view, setView] = useState<View>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
      const response = await reportingFetch(appPath('/api/records'), { cache: 'no-store' });
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
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    if (record.recordType === 'complaint') setFormMode(null);
    setView(record.recordType === 'complaint' ? 'complaints' : 'daily');
    if (record.recordType === 'complaint') setToast(`${record.referenceNumber} saved successfully.`);
  }

  function handleUpdated(record: ReportRecord) {
    setRecords((current) => current.map((item) => item.id === record.id ? record : item));
    setSelectedRecordId(record.id);
    setToast(`${record.referenceNumber} updated.`);
  }

  const viewLabel = NAV_ITEMS.find((item) => item.id === view)?.label ?? 'Dashboard';

  if (formMode === 'daily') {
    return <BlockedCallWizard onClose={() => setFormMode(null)} onSaved={handleCreated} />;
  }

  return (
    <main className={`app-shell${sidebarCollapsed ? ' app-shell--collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-heading">
          <button className="brand-mark" type="button" onClick={() => setView('dashboard')} aria-label="CM Reporting dashboard">
            <span className="brand-product">CM Reporting</span>
          </button>
          <button className="sidebar-toggle" type="button" aria-controls="primary-navigation" aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" />
              <path d={sidebarCollapsed ? 'm13 9 3 3-3 3' : 'm17 9-3 3 3 3'} />
            </svg>
          </button>
        </div>
        <div className="sidebar-logos" aria-label="Reporting partners">
          <Image className="brand-logo" src={appPath('/collective-waste-solutions.png')} alt="Collective Waste Solutions" width={172} height={43} priority />
          <span className="sidebar-logo-divider" aria-hidden="true" />
          <Image className="partner-logo" src={appPath('/Circular Materials Logo - Colour (1).png')} alt="Circular Materials" width={144} height={79} priority />
        </div>
        <p className="sidebar-scope">C9 &amp; Wood Buffalo</p>

        <nav id="primary-navigation" className="primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              className={`nav-item${view === item.id ? ' nav-item--active' : ''}`}
              type="button"
              key={item.id}
              onClick={() => setView(item.id)}
              aria-label={item.label}
              aria-current={view === item.id ? 'page' : undefined}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="nav-item__icon"><AppIcon name={item.id} /></span>
              <span className="nav-item__label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer" title="Reporting system online">
          <span className="connection-dot" aria-hidden="true" />
          <span className="sidebar-status-label"><strong>Reporting system</strong><small>Online</small></span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewLabel}</p>
            <p className="today-label">{formatTodayHeading()}</p>
          </div>
          <div className="account-controls">
            <div className="user-chip" aria-label={user ? `Signed in as ${user.name}` : 'Reporting team'}>
              <span className="user-chip__avatar">{user ? user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() : 'CM'}</span>
              <span><strong>{user?.name || 'Reporting team'}</strong><small>{user?.username || 'C9 & Wood Buffalo'}</small></span>
            </div>
            {user ? <form action={appPath('/api/auth/logout')} method="post"><button className="text-button" type="submit">Sign out</button></form> : null}
          </div>
        </header>

        <div className="content">
          {user?.kind === 'guest' ? (
            <p className="guest-session-notice" role="status">
              <strong>Guest test session.</strong> Reports and photos are saved in this app.
              {notificationsEnabled ? ' Submissions also send notification emails.' : ''}
            </p>
          ) : null}
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
          {view === 'exports' ? <ExportsView records={records} notificationsEnabled={notificationsEnabled} /> : null}
        </div>
      </section>

      {formMode === 'complaint' ? <ComplaintFormModal onClose={() => setFormMode(null)} onSaved={handleCreated} /> : null}
      {selectedRecord ? <RecordDetails record={selectedRecord} onClose={() => setSelectedRecordId('')} onUpdated={handleUpdated} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
