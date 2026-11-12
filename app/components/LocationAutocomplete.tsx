'use client';

import { useEffect, useRef, useState } from 'react';
import { appPath } from '../../lib/app-path.js';
import { reportingFetch } from '../../lib/reporting-fetch';
import type { LocationKind, LocationSuggestions, ServiceLocation } from '../../lib/location-catalogue';

type LocationOption = string | ServiceLocation;

interface Props {
  id: string;
  name?: string;
  label: string;
  kind: LocationKind | 'location';
  value: string;
  selected: boolean;
  community?: string;
  scope?: 'pickup' | 'street';
  disabled?: boolean;
  showRequired?: boolean;
  placeholder: string;
  hint?: string;
  allowFreeText?: boolean;
  onChange: (value: string, selected: boolean) => void;
  onSelectLocation?: (location: ServiceLocation) => void;
}

export default function LocationAutocomplete({ id, name, label, kind, value, selected, community = '', scope = 'pickup', disabled = false, showRequired = false, placeholder, hint, allowFreeText = false, onChange, onSelectLocation }: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ search: string; options: LocationOption[]; hasMore: boolean; error: string } | null>(null);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const search = new URLSearchParams({ kind, q: value, community, ...(kind === 'location' ? { scope } : {}) }).toString();
  const canSearch = (kind !== 'location' || !!value.trim()) && (!allowFreeText || kind !== 'address' || !!community);
  const current = result?.search === search ? result : null;
  const loading = open && !disabled && canSearch && !current;
  const options = current?.options || [];
  const activeIndex = active < options.length ? active : -1;

  useEffect(() => {
    if (!open || disabled || !canSearch) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await reportingFetch(appPath(`/api/locations?${search}`), { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json() as LocationSuggestions<LocationOption> & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'The location list could not be loaded. Try again.');
        if (!cancelled) setResult({ search, options: payload.options, hasMore: payload.hasMore, error: '' });
      } catch (error) {
        if (!cancelled) setResult({ search, options: [], hasMore: false, error: error instanceof Error ? error.message : 'The location list could not be loaded. Try again.' });
      }
    }, 180);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [open, disabled, search, retry, canSearch]);

  useEffect(() => {
    if (activeIndex >= 0) listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  function choose(option: LocationOption) {
    onChange(typeof option === 'string' ? option : option.address, true);
    if (typeof option !== 'string') onSelectLocation?.(option);
    setOpen(false); setActive(-1);
  }

  return <div className="location-autocomplete" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
  }}>
    <label htmlFor={id}>{label}{showRequired ? <b aria-hidden="true"> *</b> : null}</label>
    <div className={`location-input${selected ? ' location-input--selected' : ''}`}>
      <input id={id} name={name} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={`${id}-options`}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false} maxLength={kind === 'community' ? 250 : 500}
        placeholder={placeholder} required={kind !== 'location'} disabled={disabled} value={value}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(event) => { onChange(event.target.value, false); setOpen(true); setActive(-1); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (activeIndex >= 0) choose(options[activeIndex]);
          } else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }} />
      <span className="location-input-icon" aria-hidden="true">{selected ? '✓' : '⌕'}</span>
      {open && !disabled ? <div className="location-dropdown">
        <ul ref={listRef} id={`${id}-options`} role="listbox" aria-label={`${label} options`} aria-busy={loading}>
          {options.map((option, index) => <li key={typeof option === 'string' ? option : JSON.stringify([option.community, option.address])} id={`${id}-option-${index}`} role="option" aria-selected={activeIndex === index}
            aria-label={typeof option === 'string' ? undefined : `${option.address}, ${option.community}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{typeof option === 'string' ? option : <><strong className="location-option-address">{option.address}</strong><small className="location-option-community">{option.community}</small></>}</li>)}
        </ul>
        {loading ? <p role="status">Searching…</p> : current?.error ? <div className="location-search-error"><p role="alert">{current.error}</p><button className="text-button" type="button" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Try again</button></div>
          : !canSearch ? <p role="status">{allowFreeText ? 'Select a community for address suggestions, or enter the full address.' : 'Type an address to search all communities.'}</p>
            : !options.length ? <p role="status">No matching {kind === 'community' ? 'communities' : kind === 'street' ? 'streets' : 'addresses'}. {allowFreeText ? 'You can enter the full address.' : 'Check the spelling or contact the office.'}</p>
            : current?.hasMore ? <p role="status">Keep typing to narrow the list.</p> : null}
      </div> : null}
    </div>
    <small id={`${id}-hint`}>{disabled ? kind === 'community' ? 'Please wait.' : 'Select a community first.' : selected ? 'Selected from the service list.' : hint || 'Start typing, then choose an option from the list.'}</small>
  </div>;
}
