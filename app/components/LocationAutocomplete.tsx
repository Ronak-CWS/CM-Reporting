'use client';

import { useEffect, useRef, useState } from 'react';
import type { LocationKind, LocationSuggestions } from '../../lib/location-catalogue';

interface Props {
  id: string;
  label: string;
  kind: LocationKind;
  value: string;
  selected: boolean;
  community?: string;
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string, selected: boolean) => void;
}

export default function LocationAutocomplete({ id, label, kind, value, selected, community = '', disabled = false, placeholder, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ search: string; options: string[]; hasMore: boolean; error: string } | null>(null);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const search = new URLSearchParams({ kind, q: value, community }).toString();
  const current = result?.search === search ? result : null;
  const loading = open && !disabled && !current;
  const options = current?.options || [];
  const activeIndex = active < options.length ? active : -1;

  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/locations?${search}`, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json() as LocationSuggestions & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'The location list could not be loaded. Try again.');
        if (!cancelled) setResult({ search, options: payload.options, hasMore: payload.hasMore, error: '' });
      } catch (error) {
        if (!cancelled) setResult({ search, options: [], hasMore: false, error: error instanceof Error ? error.message : 'The location list could not be loaded. Try again.' });
      }
    }, 180);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [open, disabled, search, retry]);

  useEffect(() => {
    if (activeIndex >= 0) listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  function choose(option: string) { onChange(option, true); setOpen(false); setActive(-1); }

  return <div className="location-autocomplete" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
  }}>
    <label htmlFor={id}>{label}</label>
    <div className={`location-input${selected ? ' location-input--selected' : ''}`}>
      <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={`${id}-options`}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false} maxLength={kind === 'community' ? 250 : 500}
        placeholder={placeholder} required disabled={disabled} value={value}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(event) => { onChange(event.target.value, false); setOpen(true); setActive(-1); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (activeIndex >= 0) choose(options[activeIndex]);
          } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        }} />
      <span className="location-input-icon" aria-hidden="true">{selected ? '✓' : '⌕'}</span>
    </div>
    <small id={`${id}-hint`}>{disabled ? 'Select a community first.' : selected ? 'Selected from the service list.' : 'Start typing, then choose an option from the list.'}</small>
    {open && !disabled ? <div className="location-dropdown">
      <ul ref={listRef} id={`${id}-options`} role="listbox" aria-label={`${label} options`} aria-busy={loading}>
        {options.map((option, index) => <li key={option} id={`${id}-option-${index}`} role="option" aria-selected={activeIndex === index}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option}</li>)}
      </ul>
      {loading ? <p role="status">Searching…</p> : current?.error ? <div className="location-search-error"><p role="alert">{current.error}</p><button className="text-button" type="button" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Try again</button></div>
        : !options.length ? <p role="status">No matching {kind === 'community' ? 'communities' : kind === 'street' ? 'streets' : 'addresses'}. Check the spelling or contact the office.</p>
          : current?.hasMore ? <p role="status">Keep typing to narrow the list.</p> : null}
    </div> : null}
  </div>;
}
