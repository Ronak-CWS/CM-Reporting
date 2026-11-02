'use client';

import { useEffect, useId, useRef, useState } from 'react';

export default function MultiSelectFilter<Value extends string>({ label, plural, options, pillClassName, value, onChange }: {
  label: string; plural: string; options: readonly Value[]; pillClassName: string;
  value: Value[]; onChange: (value: Value[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    function closeOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function openOptions(index = Math.max(0, options.indexOf(value[0]))) {
    setActive(index);
    setOpen(true);
    if (open) list.current?.focus({ preventScroll: true });
  }

  function selectOption(selected: Value) {
    onChange(value.includes(selected) ? value.filter((option) => option !== selected)
      : options.filter((option) => option === selected || value.includes(option)));
  }

  const pillClass = (option: Value) => `${pillClassName} ${pillClassName}--${option.toLowerCase().replaceAll(' ', '-')}`;
  const allLabel = `All ${plural}`;

  return (
    <div className="compact-filter multi-select-filter" ref={container}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          toggle.current?.focus({ preventScroll: true });
        }
      }}>
      <span id={`${id}-label`}>{label}</span>
      <span id={`${id}-value`} className="sr-only" aria-live="polite">{value.length ? value.join(', ') : allLabel}</span>
      <div className="multi-select-filter__control" data-open={open}>
        {value.length ? <div className="multi-select-filter__values">
          {value.map((selected) => <span key={selected} className={`${pillClass(selected)} multi-select-filter__tag`}>
            <span>{selected}</span>
            <button type="button" aria-label={`Remove ${selected} ${label.toLowerCase()}`} onClick={() => {
              onChange(value.filter((option) => option !== selected));
              toggle.current?.focus({ preventScroll: true });
            }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </span>)}
        </div> : null}
        <button ref={toggle} type="button" className="multi-select-filter__toggle" aria-expanded={open} aria-haspopup="listbox"
          aria-controls={`${id}-options`} aria-labelledby={`${id}-label ${id}-value`}
          onClick={() => { if (open) setOpen(false); else openOptions(); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openOptions(event.key === 'ArrowUp' ? options.length - 1 : 0);
            }
          }}>
          {!value.length ? <span aria-hidden="true">{allLabel}</span> : null}
          <span className="multi-select-filter__chevron" aria-hidden="true" />
        </button>
      </div>
      {open ? <div className="multi-select-filter__options">
        <p>Select one or more {plural}.</p>
        <ul ref={list} id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} aria-multiselectable="true"
          tabIndex={0} aria-activedescendant={`${id}-option-${active}`} onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              setActive(event.key === 'Home' ? 0 : options.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectOption(options[active]);
            }
          }}>
          {options.map((option, index) => <li key={option} id={`${id}-option-${index}`} role="option"
            aria-selected={value.includes(option)} data-active={active === index} className="multi-select-filter__option"
            onMouseDown={(event) => event.preventDefault()} onClick={() => {
              setActive(index);
              list.current?.focus({ preventScroll: true });
              selectOption(option);
            }}>
            <span className={pillClass(option)}>{option}</span>
            {value.includes(option) ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> : null}
          </li>)}
        </ul>
        <button type="button" className="text-button multi-select-filter__all" onClick={() => onChange([])}>{allLabel}</button>
      </div> : null}
    </div>
  );
}
