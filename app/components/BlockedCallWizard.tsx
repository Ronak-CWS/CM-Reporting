'use client';

import Image from 'next/image';
import { appPath } from '../../lib/app-path.js';
import { reportingFetch, SESSION_RESTORED_EVENT } from '../../lib/reporting-fetch';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { blockageScopeLabel, findBlockedReason, searchBlockedReasons } from '../../lib/blocked-call-options';
import { MAX_PHOTOS, PHOTO_ACCEPT, photoSelectionError } from '../../lib/photo-validation';
import type { BlockageScope, ReportRecord } from '../../lib/report-types';
import ReportPhotoPreview from './ReportPhotoPreview';
import PhotoCapture, { type PhotoCaptureHandle } from './PhotoCapture';
import AppIcon from './AppIcon';
import LocationAutocomplete from './LocationAutocomplete';
import { normalizedVehiclePlates, vehiclePlateError } from '../../lib/vehicle-plates';
import './blocked-call-wizard.css';

type LocalPhoto = { id: string; file: File; url: string };
const STEPS = ['Blockage', 'Location', 'Reason', 'Photos', 'Review'];
const TITLES = ['What is blocked?', 'Where is the blockage?', 'What is blocking access?', 'Add a photo', 'Ready to submit?'];
export default function BlockedCallWizard({
  reporterName, onClose, onSaved,
}: { reporterName: string; onClose: () => void; onSaved?: (record: ReportRecord) => void }) {
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [scope, setScope] = useState<BlockageScope | null>(null);
  const [community, setCommunity] = useState('');
  const [location, setLocation] = useState('');
  const [communitySelected, setCommunitySelected] = useState(false);
  const [locationSelected, setLocationSelected] = useState(false);
  const [streetFrom, setStreetFrom] = useState('');
  const [streetTo, setStreetTo] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [reasonQuery, setReasonQuery] = useState('');
  const [showAllReasons, setShowAllReasons] = useState(false);
  const [vehiclePlates, setVehiclePlates] = useState<string[]>(['']);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [employeeName, setEmployeeName] = useState(reporterName);
  const [notes, setNotes] = useState('');
  const [routeNumber, setRouteNumber] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedRecord, setSavedRecord] = useState<ReportRecord | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const photoRef = useRef<LocalPhoto[]>([]);
  const busyRef = useRef(false);
  const submissionRef = useRef<{ signature: string; id: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<PhotoCaptureHandle>(null);
  const isStreet = scope === 'street';
  const reason = scope ? findBlockedReason(scope, reasonCode) : undefined;
  const reasonLabel = reasonCode === 'other' ? otherReason.trim() : reason?.label || '';
  const matches = scope ? searchBlockedReasons(scope, reasonQuery) : [];
  const shownReasons = reasonQuery || showAllReasons ? matches : matches.slice(0, 6);
  const hasDraft = Boolean(scope || location || community || photos.length);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step, savedRecord]);

  useEffect(() => () => {
    photoRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, []);

  useEffect(() => {
    const refreshName = (event: Event) => {
      const name: unknown = (event as CustomEvent).detail;
      if (typeof name === 'string' && name.trim()) setEmployeeName(name.trim().slice(0, 250));
    };
    window.addEventListener(SESSION_RESTORED_EVENT, refreshName);
    return () => window.removeEventListener(SESSION_RESTORED_EVENT, refreshName);
  }, []);

  useEffect(() => {
    if (!hasDraft || savedRecord) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft, savedRecord]);

  function showStep(nextStep: number) {
    setError(''); setStep(nextStep);
    setFurthestStep((current) => Math.max(current, nextStep));
  }

  function validateThrough(lastStep: number) {
    for (let index = 0; index <= lastStep; index++) {
      const message = stepError(index);
      if (message) { setStep(index); setError(message); return false; }
    }
    return true;
  }

  function goTo(nextStep: number) {
    if (busyRef.current) return;
    // Revisiting a completed step must never bypass fields invalidated by edits.
    if (nextStep > step && !validateThrough(nextStep - 1)) return;
    showStep(nextStep);
  }

  function chooseScope(nextScope: BlockageScope) {
    if (scope !== nextScope) {
      setReasonCode(''); setOtherReason(''); setReasonQuery(''); setShowAllReasons(false);
      setVehiclePlates(['']); setLocation(''); setStreetFrom(''); setStreetTo('');
      setLocationSelected(false);
    }
    setScope(nextScope);
    showStep(1);
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files || []);
    event.target.value = '';
    addPhotoFiles(chosen);
  }

  function addPhotoFiles(chosen: File[]) {
    if (!chosen.length) return;
    const nextFiles = [...photoRef.current.map((photo) => photo.file), ...chosen];
    const validationError = photoSelectionError(nextFiles);
    if (validationError) { setError(validationError); return; }
    const next = [...photoRef.current, ...chosen.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))];
    photoRef.current = next;
    setPhotos(next);
    setError('');
  }

  function removePhoto(id: string) {
    const removed = photoRef.current.find((photo) => photo.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    const next = photoRef.current.filter((photo) => photo.id !== id);
    photoRef.current = next;
    setPhotos(next);
    setError('');
  }

  function stepError(index: number) {
    if (index === 0 && !scope) return 'Choose what is blocked.';
    if (index === 1 && !communitySelected) return 'Choose a community from the list.';
    if (index === 1 && !locationSelected) return isStreet ? 'Choose a street from the list.' : 'Choose a pickup address from the list.';
    if (index === 2 && !reason) return 'Choose a reason.';
    if (index === 2 && reasonCode === 'other' && !otherReason.trim()) return 'Describe what is blocking access.';
    if (index === 2 && reason) return vehiclePlateError(reason, vehiclePlates);
    if (index === 3) return photoSelectionError(photos.map((photo) => photo.file));
    return '';
  }

  async function handleNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!validateThrough(Math.min(step, 3))) return;
    if (step < 4) { goTo(furthestStep === 4 ? 4 : step + 1); return; }
    if (!employeeName.trim()) { setError('Sign in again so your name can be added to this report.'); return; }
    const payload = {
      recordType: 'daily', category: 'Blocked call', scope,
      registeredCommunity: community.trim(), siteAddress: location.trim(),
      reasonCode, otherReason: otherReason.trim(), streetFrom: streetFrom.trim(), streetTo: streetTo.trim(),
      vehiclePlates: reason?.requiresVehiclePlate ? normalizedVehiclePlates(vehiclePlates) : [], notes: notes.trim(), employeeName: employeeName.trim(),
      routeNumber: routeNumber.trim(), serviceType,
    };
    const signature = JSON.stringify({ payload, photoIds: photos.map((photo) => photo.id) });
    if (submissionRef.current?.signature !== signature) submissionRef.current = { signature, id: crypto.randomUUID() };
    const form = new FormData();
    form.append('report', JSON.stringify(payload));
    form.append('submissionId', submissionRef.current.id);
    photos.forEach((photo) => form.append('photos', photo.file));
    busyRef.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await reportingFetch(appPath('/api/records'), { method: 'POST', body: form });
      const result = await response.json().catch(() => ({})) as { record?: ReportRecord; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error || 'Your report could not be saved. Please try again.');
      setSavedRecord(result.record);
      onSaved?.(result.record);
      photoRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
      photoRef.current = [];
      setPhotos([]);
    } catch (submitError) {
      setError(submitError instanceof TypeError
        ? 'Connection interrupted. Your entries and photos are still here. Try again.'
        : submitError instanceof Error ? submitError.message : 'Your report could not be saved. Please try again.');
    } finally { busyRef.current = false; setSaving(false); }
  }

  function startAnother() {
    setScope(null); setLocation(''); setStreetFrom(''); setStreetTo(''); setReasonCode('');
    setOtherReason(''); setReasonQuery(''); setShowAllReasons(false); setVehiclePlates(['']);
    setNotes(''); setPhotos([]); setError(''); setSavedRecord(null); setConfirmExit(false);
    submissionRef.current = null;
    setLocationSelected(false);
    setFurthestStep(0);
    showStep(0);
  }

  function requestClose() {
    if (busyRef.current) return;
    if (hasDraft && !savedRecord) setConfirmExit(true);
    else onClose();
  }

  return (
    <main className="driver-page">
      <header className="driver-header">
        <Image src={appPath('/collective-waste-solutions.png')} alt="Collective Waste Solutions" width={180} height={45} priority />
        <button className="driver-exit" type="button" onClick={requestClose} disabled={saving}>Close</button>
      </header>

      <div className="driver-workspace">
        {confirmExit ? (
          <section className="driver-card driver-exit-confirm" role="alert">
            <h1>Leave this report?</h1><p>Your report has not been submitted.</p>
            <button className="button button--primary" type="button" onClick={() => setConfirmExit(false)}>Keep reporting</button>
            <button className="text-button" type="button" onClick={onClose}>Discard and close</button>
          </section>
        ) : savedRecord ? (
          <section className="driver-card driver-success">
            <span className="driver-success-mark" aria-hidden="true">✓</span>
            <p className="eyebrow">Blocked call submitted</p>
            <h1 tabIndex={-1} ref={headingRef}>You&apos;re all set.</h1>
            <p>Your report and {savedRecord.photos.length} {savedRecord.photos.length === 1 ? 'photo are' : 'photos are'} saved.</p>
            <div className="driver-success-summary"><strong>{savedRecord.siteAddress}</strong><span>{savedRecord.registeredCommunity}</span><small>{savedRecord.referenceNumber}</small></div>
            <button className="button button--primary button--wide" type="button" onClick={startAnother}>Report another blockage</button>
            <button className="text-button" type="button" onClick={onClose}>Back to daily reporting</button>
          </section>
        ) : (
          <>
            <div className="driver-step-top"><span>Daily reporting · Blocked call</span><span>Step {step + 1} of {STEPS.length}</span></div>
            <ol className="driver-progress" aria-label="Report progress">
              {STEPS.map((label, index) => (
                <li key={label} className={index <= furthestStep ? 'is-reached' : ''}>
                  <button type="button" onClick={() => goTo(index)} disabled={saving || index > furthestStep} aria-current={index === step ? 'step' : undefined} aria-label={`Go to ${label.toLowerCase()} step`}>
                    <span className="driver-progress-line" /><span>{label}</span>
                  </button>
                </li>
              ))}
            </ol>

            <section className="driver-card" aria-busy={saving}>
              <div className="driver-card-heading">
                <h1 ref={headingRef} tabIndex={-1}>{TITLES[step]}</h1>
                <p>{[
                  'Choose the area you could not service.',
                  isStreet ? 'Search and select the community and street.' : 'Search and select the community and pickup address.',
                  'Tap the reason that fits best.',
                  'Show the blockage. One photo is required.',
                  'Check the details and select the service. Your name is filled in from your account.',
                ][step]}</p>
              </div>

              {error ? <p className="driver-error" role="alert">{error}</p> : null}

              <form onSubmit={handleNext}>
                <fieldset className="driver-fields" disabled={saving}>
                  {step === 0 ? (
                    <div className="driver-scope-options">
                      <button className="driver-scope-card" type="button" onClick={() => chooseScope('pickup')}>
                        <span className="scope-symbol scope-symbol--pickup" aria-hidden="true"><span /></span>
                        <span><strong>A pickup location</strong><small>A bin, cart, driveway, or site is blocked.</small></span><span aria-hidden="true">→</span>
                      </button>
                      <button className="driver-scope-card" type="button" onClick={() => chooseScope('street')}>
                        <span className="scope-symbol scope-symbol--street" aria-hidden="true"><span /></span>
                        <span><strong>A street / street block</strong><small>A street or section cannot be reached.</small></span><span aria-hidden="true">→</span>
                      </button>
                    </div>
                  ) : null}

                  {step === 1 ? (
                    <div className="driver-field-stack">
                      <LocationAutocomplete id="driver-community" label="Community" kind="community" value={community} selected={communitySelected} placeholder="Search communities" onChange={(value, selected) => {
                        setCommunity(value); setCommunitySelected(selected); setLocation(''); setLocationSelected(false); setStreetFrom(''); setStreetTo('');
                      }} />
                      <LocationAutocomplete key={`${scope}:${community}`} id="driver-location" label={isStreet ? 'Street name' : 'Pickup address or site'} kind={isStreet ? 'street' : 'address'} community={community} value={location} selected={locationSelected} disabled={!communitySelected} placeholder={isStreet ? 'Search streets' : 'Search service addresses'} onChange={(value, selected) => { setLocation(value); setLocationSelected(selected); }} />
                      {isStreet ? (
                        <details className="driver-optional" open={streetFrom || streetTo ? true : undefined}>
                          <summary>Add the affected section <span>(optional)</span></summary>
                          <div className="driver-field-stack">
                            <label htmlFor="street-from">From<input id="street-from" value={streetFrom} onChange={(event) => setStreetFrom(event.target.value)} placeholder="Cross street or nearest address" maxLength={250} /></label>
                            <label htmlFor="street-to">To<input id="street-to" value={streetTo} onChange={(event) => setStreetTo(event.target.value)} placeholder="Cross street or nearest address" maxLength={250} /></label>
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : null}

                  {step === 2 ? (
                    <div className="driver-field-stack">
                      {reason ? (
                        <>
                          <div className="driver-selected-reason"><span aria-hidden="true">✓</span><strong>{reason.label}</strong><button className="text-button" type="button" onClick={() => setReasonCode('')}>Change</button></div>
                          {reasonCode === 'other' ? <label htmlFor="other-blocked-reason">What is blocking access? (required)<textarea id="other-blocked-reason" value={otherReason} onChange={(event) => setOtherReason(event.target.value)} rows={3} maxLength={500} required /></label> : null}
                          {reason.requiresVehiclePlate ? <div className="driver-field-stack">
                            <p className="driver-field-hint">{reason.allowsMultipleVehiclePlates ? 'Enter at least two different plates, one per vehicle.' : 'Enter the plate of the vehicle blocking access.'}</p>
                            <div className="driver-plate-grid">
                              {vehiclePlates.map((plate, index) => <div className="driver-plate-field" key={index}>
                                <label htmlFor={`vehicle-plate-${index}`}>Vehicle plate {index + 1}{index < (reason.allowsMultipleVehiclePlates ? 2 : 1) ? ' (required)' : ' (optional)'}
                                  <input id={`vehicle-plate-${index}`} value={plate} onChange={(event) => setVehiclePlates((current) => current.map((value, position) => position === index ? event.target.value : value))} placeholder="e.g., ABC 123" maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} required={index < (reason.allowsMultipleVehiclePlates ? 2 : 1)} />
                                </label>
                                {index > 1 ? <button className="text-button" type="button" aria-label={`Remove plate ${index + 1}`} onClick={() => setVehiclePlates((current) => current.filter((_, position) => position !== index))}>Remove</button> : null}
                              </div>)}
                            </div>
                            {reason.allowsMultipleVehiclePlates ? <button className="text-button" type="button" onClick={() => setVehiclePlates((current) => [...current, ''])}>+ Add another plate</button> : null}
                          </div> : null}
                        </>
                      ) : (
                        <>
                          <label htmlFor="driver-reason-search" className="driver-search-label"><span className="sr-only">Find a reason</span><input id="driver-reason-search" type="search" value={reasonQuery} onChange={(event) => setReasonQuery(event.target.value)} placeholder="Find a reason…" /></label>
                          <div className="driver-reason-list" role="group" aria-label="Blockage reasons">
                            {shownReasons.map((option) => <button key={option.code} className="driver-reason-button" type="button" onClick={() => { setReasonCode(option.code); setVehiclePlates(option.allowsMultipleVehiclePlates ? [vehiclePlates[0] || '', vehiclePlates[1] || '', ...vehiclePlates.slice(2)] : [vehiclePlates[0] || '']); setError(''); }}><span>{option.label}</span><span aria-hidden="true">→</span></button>)}
                          </div>
                          {!reasonQuery && !showAllReasons && matches.length > 6 ? <button className="text-button driver-more-reasons" type="button" onClick={() => setShowAllReasons(true)}>Show all reasons ({matches.length})</button> : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  {step === 3 ? (
                    <div className="driver-field-stack">
                      <input ref={uploadRef} className="sr-only" type="file" accept={PHOTO_ACCEPT} multiple tabIndex={-1} aria-label="Upload blockage photos" onChange={addPhotos} />
                      <div className="driver-photo-actions">
                        <PhotoCapture ref={cameraRef} onCapture={addPhotoFiles} disabled={photos.length >= MAX_PHOTOS} />
                        <button className="button button--secondary" type="button" onClick={() => uploadRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>Upload photos</button>
                      </div>
                      <p className="driver-photo-limit">Up to 6 photos · 10 MB each · 30 MB total</p>
                      {photos.length ? (
                        <><p className="driver-photo-count">{photos.length} {photos.length === 1 ? 'photo added' : 'photos added'}</p>
                          <div className="driver-photo-grid">{photos.map((photo, index) => <figure key={photo.id}>
                            <ReportPhotoPreview src={photo.url} name={`Blockage photo ${index + 1}`} />
                            <figcaption>{photo.file.name}</figcaption>
                            <button type="button" className="photo-remove" onClick={() => removePhoto(photo.id)} aria-label={`Remove photo ${index + 1}`}>×</button>
                          </figure>)}</div></>
                      ) : <button className="driver-photo-empty" type="button" onClick={() => cameraRef.current?.openCamera()} aria-label="Open camera">
                        <AppIcon name="camera" size={40} />
                        <strong>Take a photo</strong><span>Tap here to open your camera</span>
                      </button>}
                    </div>
                  ) : null}

                  {step === 4 ? (
                    <div className="driver-field-stack">
                      <dl className="driver-review">
                        <div><dt>Blockage type</dt><dd>{scope && blockageScopeLabel(scope)}</dd><button className="text-button" type="button" onClick={() => goTo(0)} aria-label="Edit blockage type">Edit</button></div>
                        <div><dt>Location</dt><dd><strong>{location}</strong><span>{community}</span>{isStreet && (streetFrom || streetTo) ? <small>{[streetFrom && `From ${streetFrom}`, streetTo && `to ${streetTo}`].filter(Boolean).join(' ')}</small> : null}</dd><button className="text-button" type="button" onClick={() => goTo(1)} aria-label="Edit location">Edit</button></div>
                        <div><dt>Reason</dt><dd>{reasonLabel}{reason?.requiresVehiclePlate ? <small>Plates: {normalizedVehiclePlates(vehiclePlates).join(', ')}</small> : null}</dd><button className="text-button" type="button" onClick={() => goTo(2)} aria-label="Edit reason">Edit</button></div>
                        <div><dt>Photos</dt><dd>{photos.length} attached</dd><button className="text-button" type="button" onClick={() => goTo(3)} aria-label="Edit photos">Edit</button></div>
                      </dl>
                      <label htmlFor="driver-name">Your name<input id="driver-name" value={employeeName} readOnly aria-describedby="driver-name-hint" /><small id="driver-name-hint">From your signed-in account.</small></label>
                      <label htmlFor="driver-service">Service<select id="driver-service" value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option value="">Select if known</option>{['Recycling', 'Waste', 'Organics', 'Communal', 'Other'].map((service) => <option key={service}>{service}</option>)}</select></label>
                      <details className="driver-optional">
                        <summary>Add a note or route <span>(optional)</span></summary>
                        <div className="driver-field-stack">
                          <label htmlFor="driver-notes">Anything else?<textarea id="driver-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={1500} /></label>
                          <label htmlFor="driver-route">Route number<input id="driver-route" value={routeNumber} onChange={(event) => setRouteNumber(event.target.value)} maxLength={80} /></label>
                        </div>
                      </details>
                      <p className="driver-auto-note">Date and time will be recorded automatically.</p>
                    </div>
                  ) : null}
                </fieldset>

                {step > 0 ? <div className="driver-next">
                  <div className="driver-navigation">
                    <button className="button button--secondary" type="button" onClick={() => goTo(step - 1)} disabled={saving}>← Back</button>
                    <button className="button button--primary button--wide" type="submit" disabled={saving || (step === 2 && !reason) || (step === 3 && photos.length === 0)}>{saving ? 'Saving report and photos…' : step === 4 ? 'Submit blocked call' : furthestStep === 4 ? 'Return to review' : 'Continue →'}</button>
                  </div>
                  {saving ? <p role="status">Keep this screen open while your photos upload.</p> : null}
                </div> : null}
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
