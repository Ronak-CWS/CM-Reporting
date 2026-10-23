'use client';

import { useId } from 'react';
import { dateFilterError, type DateFilter as DateFilterValue, type DateMode } from '../../lib/report-filters';
import { edmontonDateKey } from '../../lib/report-time';

export default function DateFilter({ value, onChange }: {
  value: DateFilterValue; onChange: (value: DateFilterValue) => void;
}) {
  const id = useId();
  const today = edmontonDateKey();
  const error = dateFilterError(value, today);
  const describedBy = error ? `${id}-error` : undefined;
  return (
    <div className="date-filter">
      <label className="compact-filter">
        <span>Date</span>
        <select value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as DateMode })}>
          <option value="all">All dates</option>
          <option value="day">Select a date</option>
          <option value="range">Select a range</option>
        </select>
      </label>
      {value.mode !== 'all' ? (
        <label className="compact-filter">
          <span>{value.mode === 'day' ? 'Report date' : 'From'}</span>
          <input type="date" value={value.from} max={today} required aria-invalid={Boolean(error)} aria-describedby={describedBy}
            onChange={(event) => onChange({ ...value, from: event.target.value })} />
        </label>
      ) : null}
      {value.mode === 'range' ? (
        <label className="compact-filter">
          <span>To</span>
          <input type="date" value={value.to} min={value.from || undefined} max={today} required aria-invalid={Boolean(error)} aria-describedby={describedBy}
            onChange={(event) => onChange({ ...value, to: event.target.value })} />
        </label>
      ) : null}
      {error ? <p className="date-filter__error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}
