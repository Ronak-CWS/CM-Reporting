'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { STATUSES } from '../../lib/report-filters';
import type { RecordStatus } from '../../lib/report-types';

export default function StatusFilter({ value, onChange }: {
  value: RecordStatus[]; onChange: (value: RecordStatus[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return (
    <div className="compact-filter status-filter" ref={container}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          toggle.current?.focus();
        }
      }}>
      <span id={`${id}-label`}>Status</span>
      <button ref={toggle} type="button" className="status-filter__toggle" aria-expanded={open}
        aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-value`} onClick={() => setOpen(!open)}>
        <span id={`${id}-value`}>{value.length ? value.join(', ') : 'All statuses'}</span>
        <span className="status-filter__chevron" aria-hidden="true" />
      </button>
      {open ? <div className="status-filter__options" id={`${id}-options`} role="group" aria-labelledby={`${id}-label`}>
        <p>Select one or more statuses.</p>
        {STATUSES.map((status) => <label key={status} className="status-filter__option">
          <input type="checkbox" checked={value.includes(status)} onChange={(event) => {
            onChange(event.target.checked ? STATUSES.filter((option) => option === status || value.includes(option)) : value.filter((option) => option !== status));
          }} />
          <span>{status}</span>
        </label>)}
        <button type="button" className="text-button status-filter__all" onClick={() => onChange([])}>All statuses</button>
      </div> : null}
    </div>
  );
}
