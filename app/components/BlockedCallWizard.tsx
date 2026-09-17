'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { blockageScopeLabel, findBlockedReason, searchBlockedReasons } from '../../lib/blocked-call-options';
import { MAX_PHOTOS, PHOTO_ACCEPT, photoSelectionError } from '../../lib/photo-validation';
import type { BlockageScope, ReportRecord } from '../../lib/report-types';
import ReportPhotoPreview from './ReportPhotoPreview';
import './blocked-call-wizard.css';

type LocalPhoto = { id: string; file: File; url: string };
const STEPS = ['Blockage', 'Location', 'Reason', 'Photos', 'Review'];
const TITLES = ['What is blocked?', 'Where is the blockage?', 'What is blocking access?', 'Add a photo', 'Ready to submit?'];
const DRIVER_PREFERENCE = 'cm-reporting-driver-name';

function rememberedName() {
  try { return window.localStorage.getItem(DRIVER_PREFERENCE) || ''; }
  catch { return ''; }
}

export default function BlockedCallWizard({
  onClose, onSaved,
}: { onClose: () => void; onSaved: (record: ReportRecord) => void }) {
  const [step, setStep] = useState(0);
  const [scope, setScope] = useState<BlockageScope | null>(null);
  const [community, setCommunity] = useState('');
  const [location, setLocation] = useState('');
  const [streetFrom, setStreetFrom] = useState('');
  const [streetTo, setStreetTo] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [reasonQuery, setReasonQuery] = useState('');
  const [showAllReasons, setShowAllReasons] = useState(false);
  const [vehiclePlates, setVehiclePlates] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [employeeName, setEmployeeName] = useState(rememberedName);
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
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
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
    if (!hasDraft || savedRecord) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft, savedRecord]);

  function goTo(nextStep: number) { setError(''); setStep(nextStep); }

  function chooseScope(nextScope: BlockageScope) {
    if (scope !== nextScope) {
      setReasonCode(''); setOtherReason(''); setReasonQuery(''); setShowAllReasons(false);
      setVehiclePlates(''); setLocation(''); setStreetFrom(''); setStreetTo('');
    }
    setScope(nextScope);
    goTo(1);
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files || []);
    event.target.value = '';
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

  function stepError() {
    if (step === 1 && !community.trim()) return 'Enter the community.';
    if (step === 1 && !location.trim()) return isStreet ? 'Enter the blocked street.' : 'Enter the pickup address or site.';
    if (step === 2 && !reason) return 'Choose a reason.';
    if (step === 2 && reasonCode === 'other' && !otherReason.trim()) return 'Describe what is blocking access.';
    if (step === 3) return photoSelectionError(photos.map((photo) => photo.file));
    return '';
  }

  async function handleNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const validationError = stepError();
    if (validationError) { setError(validationError); return; }
    if (step < 4) { goTo(step + 1); return; }
    if (!employeeName.trim()) { setError('Enter your name.'); return; }
    const payload = {
      recordType: 'daily', category: 'Blocked call', scope,
      registeredCommunity: community.trim(), siteAddress: location.trim(),
      reasonCode, otherReason: otherReason.trim(), streetFrom: streetFrom.trim(), streetTo: streetTo.trim(),
      vehiclePlates: vehiclePlates.trim(), notes: notes.trim(), employeeName: employeeName.trim(),
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
      const response = await fetch('/api/records', { method: 'POST', body: form });
      const result = await response.json().catch(() => ({})) as { record?: ReportRecord; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error || 'Your report could not be saved. Please try again.');
      try { window.localStorage.setItem(DRIVER_PREFERENCE, employeeName.trim()); } catch { /* Optional device preference. */ }
      setSavedRecord(result.record);
      onSaved(result.record);
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
    setOtherReason(''); setReasonQuery(''); setShowAllReasons(false); setVehiclePlates('');
    setNotes(''); setPhotos([]); setError(''); setSavedRecord(null); setConfirmExit(false);
    submissionRef.current = null;
    goTo(0);
  }

  function requestClose() {
    if (busyRef.current) return;
    if (hasDraft && !savedRecord) setConfirmExit(true);
    else onClose();
  }

  return (
    <main className="driver-page">
      <header className="driver-header">
        <Image src="/collective-waste-solutions.png" alt="Collective Waste Solutions" width={180} height={45} priority />
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
                <li key={label} className={index <= step ? 'is-reached' : ''} aria-current={index === step ? 'step' : undefined}>
                  <span className="driver-progress-line" /><span>{label}</span>
                </li>
              ))}
            </ol>

            <section className="driver-card" aria-busy={saving}>
              <div className="driver-card-heading">
                {step > 0 ? <button className="driver-back" type="button" onClick={() => goTo(step - 1)} disabled={saving}>← Back</button> : null}
                <h1 ref={headingRef} tabIndex={-1}>{TITLES[step]}</h1>
                <p>{[
                  'Choose the area you could not service.',
                  isStreet ? 'Enter the street name and community.' : 'Enter the pickup address or site and community.',
                  'Tap the reason that fits best.',
                  'Show the blockage. One photo is required.',
                  'Check the details and add your name.',
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
                      <label htmlFor="driver-community">Community<input id="driver-community" value={community} onChange={(event) => setCommunity(event.target.value)} placeholder="Community name" maxLength={250} autoComplete="address-level2" required /></label>
                      <label htmlFor="driver-location">{isStreet ? 'Street name' : 'Pickup address or site'}<input id="driver-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder={isStreet ? 'e.g., 2 Avenue West' : 'Street address or site name'} maxLength={500} required /></label>
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
                          {reasonCode === 'other' ? <label htmlFor="other-blocked-reason">What is blocking access?<textarea id="other-blocked-reason" value={otherReason} onChange={(event) => setOtherReason(event.target.value)} rows={3} maxLength={500} required /></label> : null}
                          {scope === 'pickup' && reason.requiresVehiclePlate ? <label htmlFor="vehicle-plates">{reason.allowsMultipleVehiclePlates ? 'Vehicle plates' : 'Vehicle plate'} <span>(optional)</span><input id="vehicle-plates" value={vehiclePlates} onChange={(event) => setVehiclePlates(event.target.value)} placeholder={reason.allowsMultipleVehiclePlates ? 'Separate plates with commas' : 'If visible'} maxLength={500} /></label> : null}
                        </>
                      ) : (
                        <>
                          <label htmlFor="driver-reason-search" className="driver-search-label"><span className="sr-only">Find a reason</span><input id="driver-reason-search" type="search" value={reasonQuery} onChange={(event) => setReasonQuery(event.target.value)} placeholder="Find a reason…" /></label>
                          <div className="driver-reason-list" role="group" aria-label="Blockage reasons">
                            {shownReasons.map((option) => <button key={option.code} className="driver-reason-button" type="button" onClick={() => { setReasonCode(option.code); setError(''); }}><span>{option.label}</span><span aria-hidden="true">→</span></button>)}
                          </div>
                          {!reasonQuery && !showAllReasons && matches.length > 6 ? <button className="text-button driver-more-reasons" type="button" onClick={() => setShowAllReasons(true)}>Show all reasons ({matches.length})</button> : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  {step === 3 ? (
                    <div className="driver-field-stack">
                      <input ref={cameraRef} className="sr-only" type="file" accept={PHOTO_ACCEPT} capture="environment" tabIndex={-1} aria-label="Take a blockage photo" onChange={addPhotos} />
                      <input ref={uploadRef} className="sr-only" type="file" accept={PHOTO_ACCEPT} multiple tabIndex={-1} aria-label="Upload blockage photos" onChange={addPhotos} />
                      <div className="driver-photo-actions">
                        <button className="button button--primary" type="button" onClick={() => cameraRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}><span className="camera-symbol" aria-hidden="true" />Take photo</button>
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
                      ) : <div className="driver-photo-empty"><span className="camera-symbol" aria-hidden="true" /><p>Take a photo or choose one from your phone.</p></div>}
                    </div>
                  ) : null}

                  {step === 4 ? (
                    <div className="driver-field-stack">
                      <dl className="driver-review">
                        <div><dt>{scope && blockageScopeLabel(scope)}</dt><dd><strong>{location}</strong><span>{community}</span>{isStreet && (streetFrom || streetTo) ? <small>{[streetFrom && `From ${streetFrom}`, streetTo && `to ${streetTo}`].filter(Boolean).join(' ')}</small> : null}</dd><button className="text-button" type="button" onClick={() => goTo(1)} aria-label="Edit location">Edit</button></div>
                        <div><dt>Reason</dt><dd>{reasonLabel}{scope === 'pickup' && reason?.requiresVehiclePlate && vehiclePlates ? <small>Plates: {vehiclePlates}</small> : null}</dd><button className="text-button" type="button" onClick={() => goTo(2)} aria-label="Edit reason">Edit</button></div>
                        <div><dt>Photos</dt><dd>{photos.length} attached</dd><button className="text-button" type="button" onClick={() => goTo(3)} aria-label="Edit photos">Edit</button></div>
                      </dl>
                      <label htmlFor="driver-name">Your name<input id="driver-name" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} autoComplete="name" maxLength={250} required /><small>Remembered on this device for your next report.</small></label>
                      <details className="driver-optional">
                        <summary>Add a note or route <span>(optional)</span></summary>
                        <div className="driver-field-stack">
                          <label htmlFor="driver-notes">Anything else?<textarea id="driver-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={1500} /></label>
                          <label htmlFor="driver-route">Route number<input id="driver-route" value={routeNumber} onChange={(event) => setRouteNumber(event.target.value)} maxLength={80} /></label>
                          <label htmlFor="driver-service">Service<select id="driver-service" value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option value="">Select if known</option>{['Recycling', 'Waste', 'Organics', 'Communal', 'Other'].map((service) => <option key={service}>{service}</option>)}</select></label>
                        </div>
                      </details>
                      <p className="driver-auto-note">Date and time will be recorded automatically.</p>
                    </div>
                  ) : null}
                </fieldset>

                {step > 0 ? <div className="driver-next">
                  <button className="button button--primary button--wide" type="submit" disabled={saving || (step === 2 && !reason) || (step === 3 && photos.length === 0)}>{saving ? 'Saving report and photos…' : step === 4 ? 'Submit blocked call' : 'Continue →'}</button>
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
