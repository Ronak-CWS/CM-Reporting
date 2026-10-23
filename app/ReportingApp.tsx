'use client';

import Image from 'next/image';
import { appPath } from '../lib/app-path.js';
import { reportingFetch } from '../lib/reporting-fetch';
import type { SignedInUser } from '../lib/auth-store';
import BlockedCallWizard from './components/BlockedCallWizard';
import LocationAutocomplete from './components/LocationAutocomplete';
import ReportPhotoPreview from './components/ReportPhotoPreview';
import AppIcon, { type AppIconName } from './components/AppIcon';
import DateFilter from './components/DateFilter';
import { useRecordPage } from '../lib/use-record-page';
import { dateFilterError, dateFilterParams, PRIORITIES, EMPTY_OVERVIEW, type DateFilter as DateFilterValue, type ReportingOverview } from '../lib/report-filters';
import { blockageScopeLabel } from '../lib/blocked-call-options';
import { COMPLAINT_CATEGORIES, COMPLAINT_OTHER_REASON_LIMIT, complaintCategoryError } from '../lib/complaint-options';
import {
  type FormEvent,
  useCallback,
  useEffect,
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
  overview,
  loading,
  onCreate,
  onOpenRecord,
  onChangeView,
}: {
  records: ReportRecord[];
  overview: ReportingOverview;
  loading: boolean;
  onCreate: (mode: RecordType) => void;
  onOpenRecord: (record: ReportRecord) => void;
  onChangeView: (view: View) => void;
}) {
  const recentRecords = records;

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
          value={overview.todayRecords}
          detail={`${overview.todayCommunities} registered ${overview.todayCommunities === 1 ? 'community' : 'communities'}`}
          tone="accent"
        />
        <MetricCard
          label="Open actions"
          icon="clock"
          value={overview.openActions}
          detail={`${overview.flaggedActions} high priority`}
          tone={overview.flaggedActions ? 'warning' : 'default'}
        />
        <MetricCard
          label="Complaints today"
          icon="complaints"
          value={overview.todayComplaints}
          detail={`${overview.acknowledgedComplaints} acknowledged or resolved`}
          tone="complaint"
        />
        <MetricCard
          label="Resolved today"
          icon="check"
          value={overview.resolvedToday}
          detail={overview.resolvedToday ? 'Corrective actions recorded' : 'No resolutions yet'}
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
            <span className={`status-pill ${overview.flaggedActions ? 'status-pill--in-progress' : 'status-pill--resolved'}`}>
              {overview.flaggedActions ? 'Review needed' : 'On track'}
            </span>
          </div>
          <div className="summary-time">
            <strong>5:00 PM</strong>
            <span>America/Edmonton</span>
          </div>
          <div className="summary-facts">
            <span><strong>{overview.todayRecords}</strong> records today</span>
            <span><strong>{overview.openActions}</strong> open actions</span>
            <span><strong>{overview.flaggedActions}</strong> flagged</span>
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

export function RegisterView({
  mode, revision, onCreate, onOpenRecord,
}: {
  mode: RecordType;
  revision: number;
  onCreate: () => void;
  onOpenRecord: (record: ReportRecord) => void;
}) {
  const isComplaint = mode === 'complaint';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dates, setDates] = useState<DateFilterValue>({ mode: 'all', from: '', to: '' });
  const dateError = dateFilterError(dates);
  const params = dateFilterParams(dates);
  params.set('type', mode);
  if (search.trim()) params.set('q', search.trim());
  if (statusFilter) params.set('status', statusFilter);
  if (priorityFilter) params.set('priority', priorityFilter);
  const page = useRecordPage(params.toString(), revision, !dateError);
  const sentinel = useRef<HTMLDivElement>(null);
  const { loadMore, nextCursor, loading, error } = page;
  useEffect(() => {
    if (!nextCursor || loading || error || dateError || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: '200px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [dateError, error, loadMore, loading, nextCursor]);
  const hasFilters = Boolean(search || statusFilter || priorityFilter || dates.mode !== 'all');

  function clearFilters() {
    setSearch(''); setStatusFilter(''); setPriorityFilter('');
    setDates({ mode: 'all', from: '', to: '' });
  }

  return (
    <>
      <div className="page-heading page-heading--register">
        <div>
          <p className="eyebrow">{isComplaint ? 'Exhibit 7 register' : 'Operations register'}</p>
          <h1>{isComplaint ? 'Complaint reporting' : 'Daily reporting'}</h1>
          <p className="page-intro">{isComplaint
            ? 'Track inquiries and complaints, customer addresses, and the actions taken to resolve them.'
            : 'Pickup or street blocked? Add the location, choose a reason, and take a photo.'}</p>
        </div>
        <button className="button button--primary" type="button" onClick={onCreate}>
          {isComplaint ? 'Log complaint' : 'Report blocked call'}
        </button>
      </div>

      <section className="register-filters" aria-label="Record filters">
        <label className="search-field">
          <span className="sr-only">Search records</span>
          <AppIcon name="search" size={20} />
          <input type="search" value={search} maxLength={250} onChange={(event) => setSearch(event.target.value)}
            placeholder={isComplaint ? 'Search reference, address, customer, or complaint' : 'Search reference, location, route, or report'} />
        </label>
        <div className="register-filter-row">
          <label className="compact-filter">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label className="compact-filter">
            <span>Priority</span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="">All priorities</option>
              {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
            </select>
          </label>
          <DateFilter value={dates} onChange={setDates} />
          {hasFilters ? <button type="button" className="text-button clear-filters" onClick={clearFilters}>Clear filters</button> : null}
        </div>
        <div className="register-results" aria-live="polite" aria-atomic="true">
          <span>{dateError ? 'Choose valid dates to view records' : page.loading && !page.records.length ? 'Finding records?'
            : `Showing ${page.records.length.toLocaleString()} of ${page.total.toLocaleString()} ${page.total === 1 ? 'record' : 'records'}`}</span>
          <span>Newest first ? 50 at a time</span>
        </div>
      </section>

      <section className={`panel register-panel${isComplaint ? ' register-panel--complaints' : ''}`} aria-label={isComplaint ? 'Complaint records' : 'Daily records'} aria-busy={page.loading}>
        <div className="record-table__head" aria-hidden="true">
          <span>Reference</span>
          <span>{isComplaint ? 'Customer and community' : 'Event and community'}</span>
          {isComplaint ? <span>Address</span> : null}
          <span>{isComplaint ? 'Inquiry or complaint' : 'Operational detail'}</span>
          <span>{isComplaint ? 'Resolution' : 'Owner'}</span>
          <span>Status</span>
        </div>
        {page.records.length ? (
          <div className="record-table">
            {page.records.map((record) => (
              <button className="record-row" type="button" key={record.id} onClick={() => onOpenRecord(record)}>
                <span className="record-cell record-cell--reference">
                  <strong>{record.referenceNumber}</strong>
                  <small>{formatShortDateTime(record.occurredAt)}</small>
                </span>
                <span className="record-cell record-cell--customer">
                  <strong>{isComplaint ? record.customerName || 'Name not provided' : record.blockage ? blockageScopeLabel(record.blockage.scope) : record.category}</strong>
                  <small>{record.registeredCommunity}</small>
                </span>
                {isComplaint ? <span className="record-cell record-cell--address"><small className="record-cell__mobile-label">Address</small><strong>{record.customerAddress || 'Not recorded'}</strong></span> : null}
                <span className="record-cell record-cell--description">
                  <strong>{record.issueDescription}</strong>
                  <small>{isComplaint ? record.contactMedium : [record.siteAddress, record.photos?.length ? `${record.photos.length} photos` : ''].filter(Boolean).join(' ? ') || 'No location details'}</small>
                </span>
                <span className="record-cell record-cell--resolution">
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
        ) : page.loading ? (
          <div className="record-skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <div key={index}><i /><i /><i /><i /></div>)}
          </div>
        ) : !page.error ? (
          <EmptyState title={dateError ? 'Select a date or a valid range' : hasFilters ? 'No matching records' : isComplaint ? 'No complaints logged' : 'No daily reports logged'}
            copy={dateError ? 'Dates may include today. A range must start before it ends.' : hasFilters ? 'Try another search, priority, status, or date.' : 'New reports will appear here as they are saved.'}
            actionLabel={hasFilters ? 'Clear filters' : isComplaint ? 'Log complaint' : 'Report blocked call'}
            onAction={hasFilters ? clearFilters : onCreate} />
        ) : null}
        <div className="record-pagination" ref={sentinel}>
          {page.loading ? <div className="record-loading-indicator" role="status"><span className="loading-ring" aria-hidden="true" />{page.records.length ? 'Loading more records?' : 'Loading records?'}</div>
            : page.error ? <div className="record-load-error" role="alert"><span>{page.error}</span><button type="button" className="text-button" onClick={page.retry}>Try again</button></div>
            : page.nextCursor ? <button type="button" className="button button--secondary" onClick={page.loadMore}>Load 50 more</button>
            : page.records.length ? <span>All matching records are shown.</span> : null}
        </div>
      </section>
    </>
  );
}

function ExportCard({ type, title, description }: { type: 'daily' | 'complaints'; title: string; description: string }) {
  const today = edmontonDateKey();
  const first = type === 'complaints' ? monthStartDateKey() : today;
  const [dates, setDates] = useState<DateFilterValue>({ mode: first === today ? 'day' : 'range', from: first, to: today });
  const error = dateFilterError(dates);
  const params = dateFilterParams(dates);
  params.set('type', type);
  const exportUrl = (format: 'xlsx' | 'csv') => appPath(`/api/export?${params}&format=${format}`);
  return (
    <article className={`panel export-card${type === 'complaints' ? ' export-card--orange' : ''}`}>
      <div className="export-card__mark">{type === 'complaints' ? '7' : 'D'}</div>
      <div>
        <p className="eyebrow">{type === 'complaints' ? 'Exhibit 7' : 'Daily summary'}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <DateFilter value={dates} onChange={setDates} />
      <div className="export-card__footer">
        <span>{error ? 'Choose valid dates' : 'All matching records included'}</span>
        {error ? <button className="button button--primary" type="button" disabled>Download CSV</button>
          : <a className="button button--primary" href={exportUrl('csv')}>Download CSV</a>}
      </div>
    </article>
  );
}

function ExportsView({ notificationsEnabled }: { notificationsEnabled: boolean }) {
  return (
    <>
      <div className="page-heading page-heading--register">
        <div>
          <p className="eyebrow">CM deliverables</p>
          <h1>Reports and exports</h1>
          <p className="page-intro">Download reports for a selected date or date range.</p>
        </div>
      </div>
      <section className="export-grid">
        <ExportCard type="daily" title="Operational activity export"
          description="Blocked calls, complaints, locations, photo references, corrective actions, and current status." />
        <ExportCard type="complaints" title="Complaint record export"
          description="The Exhibit 7 inquiry, employee, customer, and resolution fields." />
      </section>
      <section className="panel delivery-panel">
        <div>
          <p className="eyebrow">Report notifications</p>
          <h2>Email updates after submission</h2>
          <p>{notificationsEnabled
            ? 'New blocked-call reports and complaints are queued for email to the reporting team. Download CSV exports above when needed.'
            : 'Email notifications are not enabled yet. Reports are saved in the dashboard, and CSV exports are available above.'}</p>
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
  reporterName, onClose, onSaved,
}: {
  reporterName: string;
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
                <Field label="Employee name" name="employeeName" required><input id="employeeName" name="employeeName" type="text" defaultValue={reporterName} autoComplete="off" required /></Field>
                <Field label="Employee title" name="employeeTitle" required><input id="employeeTitle" name="employeeTitle" type="text" placeholder="Customer service representative" required /></Field>
              </div>
            </fieldset>
            <fieldset disabled={saving}>
              <legend><span className="form-section-number" aria-hidden="true">3</span>Person making the inquiry or complaint</legend>
              <div className="form-grid">
                <Field label="Customer name (optional)" name="customerName"><input id="customerName" name="customerName" type="text" /></Field>
                <Field label="Address" name="customerAddress" required><input id="customerAddress" name="customerAddress" type="text" autoComplete="street-address" required /></Field>
                <Field label="Contact information" name="customerContactInformation" hint="Optional. Phone number, email address, or other preferred contact, if provided."><input id="customerContactInformation" name="customerContactInformation" type="text" /></Field>
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

export default function ReportingApp({ user = null, reporterName = user?.name || 'Local development', notificationsEnabled = false }: { user?: SignedInUser | null; reporterName?: string; notificationsEnabled?: boolean }) {
  const [view, setView] = useState<View>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [records, setRecords] = useState<ReportRecord[]>([]);
  const [overview, setOverview] = useState<ReportingOverview>(EMPTY_OVERVIEW);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [selectedRecord, setSelectedRecord] = useState<ReportRecord | null>(null);
  const [toast, setToast] = useState('');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await reportingFetch(appPath('/api/records?view=overview'), { cache: 'no-store' });
      const result = await readApiResponse<{ records: ReportRecord[]; overview: ReportingOverview }>(response);
      setRecords(result.records);
      setOverview(result.overview || EMPTY_OVERVIEW);
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

  function handleCreated(record: ReportRecord) {
    setRevision((current) => current + 1);
    void loadRecords();
    if (record.recordType === 'complaint') setFormMode(null);
    setView(record.recordType === 'complaint' ? 'complaints' : 'daily');
    if (record.recordType === 'complaint') setToast(`${record.referenceNumber} saved successfully.`);
  }

  function handleUpdated(record: ReportRecord) {
    setSelectedRecord(record);
    setRevision((current) => current + 1);
    void loadRecords();
    setToast(`${record.referenceNumber} updated.`);
  }

  const viewLabel = NAV_ITEMS.find((item) => item.id === view)?.label ?? 'Dashboard';

  if (formMode === 'daily') {
    return <BlockedCallWizard reporterName={reporterName} onClose={() => setFormMode(null)} onSaved={handleCreated} />;
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
          {loadError ? (
            <div className="load-error" role="alert">
              <span>{loadError}</span>
              <button className="text-button" type="button" onClick={() => void loadRecords()}>Try again</button>
            </div>
          ) : null}

          {view === 'dashboard' ? (
            <DashboardView
              records={records}
              overview={overview}
              loading={loading}
              onCreate={setFormMode}
              onOpenRecord={setSelectedRecord}
              onChangeView={setView}
            />
          ) : null}
          {view === 'daily' ? (
            <RegisterView
              mode="daily"
              key={view}
              revision={revision}
              onCreate={() => setFormMode('daily')}
              onOpenRecord={setSelectedRecord}
            />
          ) : null}
          {view === 'complaints' ? (
            <RegisterView
              mode="complaint"
              key={view}
              revision={revision}
              onCreate={() => setFormMode('complaint')}
              onOpenRecord={setSelectedRecord}
            />
          ) : null}
          {view === 'exports' ? <ExportsView notificationsEnabled={notificationsEnabled} /> : null}
        </div>
      </section>

      {formMode === 'complaint' ? <ComplaintFormModal reporterName={reporterName} onClose={() => setFormMode(null)} onSaved={handleCreated} /> : null}
      {selectedRecord ? <RecordDetails record={selectedRecord} onClose={() => setSelectedRecord(null)} onUpdated={handleUpdated} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
