'use client';

import { useEffect, useState } from 'react';
import { appPath } from '../../lib/app-path.js';
import { reportingFetch } from '../../lib/reporting-fetch';
import AppIcon from './AppIcon';

type Settings = { recipients: string[]; senders: string[]; automaticEnabled: boolean; day: string; reportCount: number; photoCount: number; sendAt: string };
type Result = { accepted: string[]; failed: Array<{ recipient: string; code: string }> };

export default function ReportEmailActions() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [sender, setSender] = useState('');
  const [recipientOverride, setRecipientOverride] = useState('');
  const endpoint = appPath('/api/email/blocked-calls');

  useEffect(() => {
    let active = true;
    void reportingFetch(endpoint, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json() as Partial<Settings> & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Email settings could not be loaded.');
      if (!Array.isArray(body.recipients) || !Array.isArray(body.senders) || !body.senders.length || typeof body.automaticEnabled !== 'boolean') throw new Error('Email settings could not be loaded.');
      if (active) {
        setSettings(body as Settings);
        setSender(body.senders[0]);
      }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Email settings could not be loaded.'); });
    return () => { active = false; };
  }, [endpoint]);

  async function sendTest() {
    if (!settings || sending || result) return;
    setSending(true);
    setError('');
    try {
      const response = await reportingFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sender, ...(recipientOverride.trim() ? { to: recipientOverride.trim() } : {}) }) });
      const body = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(body.error || 'The email test failed.');
      if (!Array.isArray(body.accepted) || !Array.isArray(body.failed)) throw new Error('The email test result could not be read. Check the recipients before trying again.');
      setResult(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The email test failed.'); }
    finally { setSending(false); }
  }

  return <section className="panel report-email-actions" aria-labelledby="email-report-title">
    <div className="report-email-actions__header">
      <div className="report-email-actions__heading">
        <span className="export-card__mark"><AppIcon name="mail" /></span>
        <div>
          <p className="eyebrow">Daily report delivery</p>
          <h2 id="email-report-title">Today&apos;s blocked-call email</h2>
          <p className="report-email-actions__intro">Preview today&apos;s report or send a test with the PDF and all photos attached.</p>
        </div>
      </div>
      {settings ? <span className={`report-email-actions__badge${settings.automaticEnabled ? ' report-email-actions__badge--on' : ''}`}>
        <span aria-hidden="true" />Automatic emails {settings.automaticEnabled ? 'on' : 'off'}
      </span> : null}
    </div>
    {settings ? <dl className="report-email-actions__summary">
      <div><dt>Report day · Edmonton</dt><dd><time dateTime={settings.day}>{settings.day}</time></dd></div>
      <div><dt>Blocked calls</dt><dd>{settings.reportCount.toLocaleString()}</dd></div>
      <div><dt>Photos included</dt><dd>{settings.photoCount.toLocaleString()}</dd></div>
    </dl> : !error ? <p className="report-email-actions__loading">Loading email settings...</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void sendTest(); }} aria-busy={sending}>
      {settings ? <div className="report-email-actions__fields">
        <div className="form-field">
          <label htmlFor="test-email-sender">Test sender</label>
          <select id="test-email-sender" value={sender} disabled={sending} aria-describedby="test-email-sender-help" onChange={(event) => {
            setSender(event.target.value); setResult(null); setError('');
          }}>
            {settings.senders.map((address) => <option key={address} value={address}>{address}</option>)}
          </select>
          <small id="test-email-sender-help">The address this test email will be sent from.</small>
        </div>
        <div className="form-field">
          <label htmlFor="test-email-to">Send to <span className="report-email-actions__optional">(optional)</span></label>
          <input id="test-email-to" type="text" inputMode="email" autoComplete="off" spellCheck={false}
            value={recipientOverride} maxLength={25600} disabled={sending} placeholder={settings.recipients.join(', ')}
            aria-describedby="test-email-to-help test-email-to-default" onChange={(event) => {
              setRecipientOverride(event.target.value); setResult(null); setError('');
            }} />
          <small id="test-email-to-help">Leave blank to use the default below. Separate multiple addresses with commas or semicolons.</small>
          <small id="test-email-to-default">Default: <strong>{settings.recipients.join(', ')}</strong></small>
        </div>
      </div> : null}
      <div className="report-email-actions__footer">
        <div className="report-email-actions__previews">
          <a className="button button--secondary" href={appPath('/api/email/blocked-calls/report')} target="_blank" rel="noreferrer"><AppIcon name="exports" size={17} />Preview today&apos;s PDF</a>
          <a className="button button--secondary" href={appPath('/api/email/blocked-calls/report?format=xlsx')} target="_blank" rel="noreferrer"><AppIcon name="exports" size={17} />Preview today&apos;s Excel</a>
        </div>
        <button className="button button--primary" type="submit" disabled={!settings || sending || Boolean(result)}>
          <AppIcon name={result ? 'check' : 'mail'} size={18} />
          {sending ? 'Sending test...' : result ? 'Test completed' : 'Send test email'}
        </button>
      </div>
    </form>
    {settings ? <p className="report-email-actions__schedule"><AppIcon name="clock" size={16} />
      <span>Schedule: {settings.sendAt} Edmonton time. Recipient edits apply to this test only; the automatic schedule and saved recipients stay unchanged.</span>
    </p> : null}
    {error ? <p className="report-email-actions__message report-email-actions__message--error" role="alert">{error}</p> : null}
    {result?.accepted.length ? <p className="report-email-actions__message report-email-actions__message--success" role="status">The relay accepted the test for {result.accepted.join(', ')}. Check those inboxes and the attached PDF.</p> : null}
    {result?.failed.length ? <div className="report-email-actions__message report-email-actions__message--error" role="alert">
      <p>The relay did not accept the test for:</p>
      <ul>{result.failed.map(({ recipient, code }) => <li key={recipient}>{recipient} ({code})</li>)}</ul>
      <p>Ask IT to check relay access and the permitted sender and recipient addresses.</p>
    </div> : null}
  </section>;
}
