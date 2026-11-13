'use client';

import { useEffect, useRef, useState } from 'react';
import { appPath } from '../../lib/app-path.js';
import { reportingFetch } from '../../lib/reporting-fetch';
import AppIcon from './AppIcon';

type Format = 'pdf' | 'xlsx';
type Automatic = { enabled: boolean; to: string[]; cc: string[]; formats: Format[] };
type Settings = { recipients: string[]; cc: string[]; senders: string[]; automatic: Automatic; today: string; day: string; reportCount: number; photoCount: number; sendAt: string };
type Result = { accepted: string[]; failed: Array<{ recipient: string; code: string }> };

function Formats({ value, onChange, disabled, label }: { value: Format[]; onChange: (formats: Format[]) => void; disabled: boolean; label: string }) {
  return <fieldset className="report-email-actions__formats" disabled={disabled}>
    <legend>{label}</legend>
    {(['pdf', 'xlsx'] as Format[]).map((format) => <label key={format}>
      <input type="checkbox" checked={value.includes(format)} onChange={(event) => onChange(event.target.checked
        ? (['pdf', 'xlsx'] as Format[]).filter((item) => item === format || value.includes(item)) : value.filter((item) => item !== format))} />
      {format === 'pdf' ? 'PDF' : 'Excel'}
    </label>)}
    <small>Photos are included in both formats.</small>
  </fieldset>;
}

function AutomaticDelivery({ initial, sendAt, endpoint }: { initial: Automatic; sendAt: string; endpoint: string }) {
  const [saved, setSaved] = useState(initial);
  const [to, setTo] = useState(initial.to.join(', '));
  const [cc, setCc] = useState(initial.cc.join(', '));
  const [formats, setFormats] = useState(initial.formats);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = to !== saved.to.join(', ') || cc !== saved.cc.join(', ') || JSON.stringify(formats) !== JSON.stringify(saved.formats);
  function edited() { setMessage(''); setError(''); }
  async function save(enabled = saved.enabled, toggleOnly = false) {
    if (saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      // Switching off must work even if an unfinished form contains invalid addresses.
      const changes = toggleOnly && !enabled ? { enabled } : { enabled, to, cc, formats };
      const response = await reportingFetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const body = await response.json() as { automatic: Automatic; error?: string };
      if (!response.ok) throw new Error(body.error || 'Automatic settings could not be saved.');
      setSaved(body.automatic);
      if (!(toggleOnly && !enabled)) { setTo(body.automatic.to.join(', ')); setCc(body.automatic.cc.join(', ')); setFormats(body.automatic.formats); }
      setMessage(toggleOnly ? `Automatic emails ${enabled ? 'turned on' : 'turned off'}.` : 'Automatic email settings saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Automatic settings could not be saved.'); }
    finally { setSaving(false); }
  }
  return <section className="report-email-actions__automatic" aria-labelledby="automatic-email-title">
    <div className="report-email-actions__header">
      <div><h3 id="automatic-email-title">Automatic daily email</h3>
        <p className="report-email-actions__intro">Every day at {sendAt} Edmonton time, with that day&apos;s blocked calls.</p></div>
      <button type="button" role="switch" aria-checked={saved.enabled} aria-label="Automatic daily email" disabled={saving || (!saved.enabled && !formats.length)}
        className={`report-email-actions__switch${saved.enabled ? ' report-email-actions__switch--on' : ''}`}
        onClick={() => void save(!saved.enabled, true)}><span aria-hidden="true" />{saving ? 'Saving...' : saved.enabled ? 'On' : 'Off'}</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} aria-busy={saving}>
      <div className="report-email-actions__fields">
        <div className="form-field"><label htmlFor="automatic-email-to">Automatic To</label>
          <input id="automatic-email-to" value={to} onChange={(event) => { setTo(event.target.value); edited(); }} disabled={saving} maxLength={25600} inputMode="email" autoComplete="off" spellCheck={false} />
          <small>Leave blank to use the server&apos;s automatic recipients.</small></div>
        <div className="form-field"><label htmlFor="automatic-email-cc">Automatic CC (optional)</label>
          <input id="automatic-email-cc" value={cc} onChange={(event) => { setCc(event.target.value); edited(); }} disabled={saving} maxLength={25600} inputMode="email" autoComplete="off" spellCheck={false} />
          <small>Separate addresses with commas or semicolons. Clear to remove CC.</small></div>
      </div>
      <div className="report-email-actions__automatic-footer">
        <Formats label="Automatic attachments" value={formats} onChange={(value) => { setFormats(value); edited(); }} disabled={saving} />
        <button type="submit" className="button button--secondary" disabled={saving || !formats.length || !dirty}>Save automatic settings</button>
      </div>
      {dirty ? <p className="report-email-actions__intro">Recipient or attachment changes have not been saved.</p> : null}
    </form>
    {message ? <p className="report-email-actions__message report-email-actions__message--success" role="status">{message}</p> : null}
    {error ? <p className="report-email-actions__message report-email-actions__message--error" role="alert">{error}</p> : null}
  </section>;
}

export default function ReportEmailActions() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [sender, setSender] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [formats, setFormats] = useState<Format[]>(['pdf']);
  const initialized = useRef(false);
  const endpoint = appPath('/api/email/blocked-calls');

  useEffect(() => {
    if (day === '') return;
    let active = true;
    void reportingFetch(endpoint + (day ? `?day=${encodeURIComponent(day)}` : ''), { cache: 'no-store' }).then(async (response) => {
      const body = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Email settings could not be loaded.');
      if (!Array.isArray(body.recipients) || !Array.isArray(body.senders) || !body.senders.length || typeof body.automatic?.enabled !== 'boolean') throw new Error('Email settings could not be loaded.');
      if (active) {
        setSettings(body);
        if (!initialized.current) { setSender(body.senders[0]); setCc(body.cc.join(', ')); initialized.current = true; }
      }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Email settings could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint, day]);

  function edited() { setResult(null); setError(''); }
  const selectedDay = day ?? settings?.day ?? '';
  const ready = Boolean(settings && !loading && settings.day === selectedDay);
  async function sendManually() {
    if (!ready || sending || !formats.length || result?.accepted.length) return;
    setSending(true); setError('');
    try {
      const response = await reportingFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sender, day: selectedDay, formats, cc, ...(to.trim() ? { to: to.trim() } : {}) }) });
      const body = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(body.error || 'The email could not be sent.');
      if (!Array.isArray(body.accepted) || !Array.isArray(body.failed)) throw new Error('The email result could not be read. Check the recipients before trying again.');
      setResult(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The email could not be sent.'); }
    finally { setSending(false); }
  }

  return <section className="panel report-email-actions" aria-labelledby="email-report-title">
    <div className="report-email-actions__heading">
      <span className="export-card__mark"><AppIcon name="mail" /></span>
      <div><p className="eyebrow">Report delivery</p><h2 id="email-report-title">Blocked-call emails</h2>
        <p className="report-email-actions__intro">Send one email to everyone in To and CC, with the reports you choose.</p></div>
    </div>
    {settings ? <>
      <form onSubmit={(event) => { event.preventDefault(); void sendManually(); }} aria-busy={sending} aria-label="Manual email">
        <h3 className="report-email-actions__manual-title">Send manually</h3>
        <div className="report-email-actions__fields">
          <div className="form-field"><label htmlFor="manual-report-day">Report date</label>
            <input id="manual-report-day" type="date" value={selectedDay} max={settings.today} required disabled={sending} onChange={(event) => {
              setDay(event.target.value); setLoading(Boolean(event.target.value)); edited();
            }} /><small>Only this date&apos;s blocked calls, using Edmonton time.</small></div>
          <div className="form-field"><label htmlFor="manual-email-sender">From</label>
            <select id="manual-email-sender" value={sender} disabled={sending} onChange={(event) => { setSender(event.target.value); edited(); }}>
              {settings.senders.map((address) => <option key={address} value={address}>{address}</option>)}
            </select></div>
        </div>
        <dl className="report-email-actions__summary" aria-live="polite">
          <div><dt>Report day · Edmonton</dt><dd><time dateTime={selectedDay}>{selectedDay}</time></dd></div>
          <div><dt>Blocked calls</dt><dd>{ready ? settings.reportCount.toLocaleString() : '—'}</dd></div>
          <div><dt>Photos included</dt><dd>{ready ? settings.photoCount.toLocaleString() : '—'}</dd></div>
        </dl>
        <div className="report-email-actions__fields">
          <div className="form-field"><label htmlFor="manual-email-to">To</label>
            <input id="manual-email-to" value={to} disabled={sending} placeholder={settings.recipients.join(', ')} onChange={(event) => { setTo(event.target.value); edited(); }} maxLength={25600} inputMode="email" autoComplete="off" spellCheck={false} aria-describedby="manual-email-to-help" />
            <small id="manual-email-to-help">Leave blank for: <strong>{settings.recipients.join(', ')}</strong></small></div>
          <div className="form-field"><label htmlFor="manual-email-cc">CC (optional)</label>
            <input id="manual-email-cc" value={cc} disabled={sending} onChange={(event) => { setCc(event.target.value); edited(); }} maxLength={25600} inputMode="email" autoComplete="off" spellCheck={false} />
            <small>Separate addresses with commas or semicolons. Clear to send without CC.</small></div>
        </div>
        <Formats label="Manual attachments" value={formats} disabled={sending} onChange={(value) => { setFormats(value); edited(); }} />
        <div className="report-email-actions__footer">
          <div className="report-email-actions__previews">{ready ? <>
            <a className="button button--secondary" href={appPath(`/api/email/blocked-calls/report?day=${selectedDay}&format=pdf`)} target="_blank" rel="noreferrer"><AppIcon name="exports" size={17} />Preview PDF</a>
            <a className="button button--secondary" href={appPath(`/api/email/blocked-calls/report?day=${selectedDay}&format=xlsx`)} target="_blank" rel="noreferrer"><AppIcon name="exports" size={17} />Preview Excel</a>
          </> : null}</div>
          <button className="button button--primary" type="submit" disabled={!ready || sending || !formats.length || Boolean(result?.accepted.length)}>
            <AppIcon name={result?.accepted.length ? 'check' : 'mail'} size={18} />{sending ? 'Sending...' : result?.accepted.length ? 'Email submitted' : 'Send email manually'}
          </button>
        </div>
      </form>
      {result?.accepted.length ? <p className="report-email-actions__message report-email-actions__message--success" role="status">The relay accepted the email for {result.accepted.join(', ')}. Check those inboxes and the attachments.</p> : null}
      {result?.failed.length ? <div className="report-email-actions__message report-email-actions__message--error" role="alert">
        <p>The relay did not accept these recipients:</p><ul>{result.failed.map(({ recipient, code }) => <li key={recipient}>{recipient} ({code})</li>)}</ul>
        <p>Check these addresses before trying again. Recipients already accepted may have received the email.</p>
      </div> : null}
    </> : loading ? <p className="report-email-actions__loading">Loading email settings...</p> : null}
    {error ? <p className="report-email-actions__message report-email-actions__message--error" role="alert">{error}</p> : null}
    {settings ? <AutomaticDelivery initial={settings.automatic} sendAt={settings.sendAt} endpoint={endpoint} /> : null}
  </section>;
}
