'use client';

import { useEffect, useState } from 'react';
import { appPath } from '../../lib/app-path.js';
import { reportingFetch } from '../../lib/reporting-fetch';

type Settings = { recipients: string[]; senders: string[]; automaticEnabled: boolean; day: string; reportCount: number; photoCount: number; sendAt: string };
type Result = { accepted: string[]; failed: Array<{ recipient: string; code: string }> };

export default function ReportEmailActions() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [sender, setSender] = useState('');
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
    if (sending || result) return;
    setSending(true);
    setError('');
    try {
      const response = await reportingFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: sender }) });
      const body = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(body.error || 'The email test failed.');
      if (!Array.isArray(body.accepted) || !Array.isArray(body.failed)) throw new Error('The email test result could not be read. Check the recipients before trying again.');
      setResult(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The email test failed.'); }
    finally { setSending(false); }
  }

  return <section className="detail-section report-email-actions" aria-labelledby="email-report-title">
    <h3 id="email-report-title">Today&apos;s blocked-call email</h3>
    <p>Download today&apos;s blocked calls with photos as PDF or Excel, using Edmonton time. Test emails attach the PDF.</p>
    {settings ? <>
      <p><strong>{settings.day}:</strong> {settings.reportCount} blocked call(s), {settings.photoCount} photo(s).</p>
      <label className="report-email-actions__sender" htmlFor="test-email-sender">Test sender
        <select id="test-email-sender" value={sender} disabled={sending} onChange={(event) => {
          setSender(event.target.value); setResult(null); setError('');
        }}>
          {settings.senders.map((address) => <option key={address} value={address}>{address}</option>)}
        </select>
      </label>
      <p><strong>To:</strong> {settings.recipients.join(', ')}</p>
      <p>Automatic emails are <strong>{settings.automaticEnabled ? 'on' : 'off'}</strong>. Schedule: {settings.sendAt} Edmonton time. A test does not enable the schedule.</p>
    </> : !error ? <p>Loading email settings...</p> : null}
    <div className="report-email-actions__buttons">
      <a className="button button--secondary" href={appPath('/api/email/blocked-calls/report')} target="_blank" rel="noreferrer">Preview today&apos;s PDF</a>
      <a className="button button--secondary" href={appPath('/api/email/blocked-calls/report?format=xlsx')} target="_blank" rel="noreferrer">Preview today&apos;s Excel</a>
      <button className="button button--primary" type="button" disabled={!settings || sending || Boolean(result)} onClick={() => void sendTest()}>
        {sending ? 'Sending test...' : result ? 'Test completed' : 'Send test email'}
      </button>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {result?.accepted.length ? <p role="status">The relay accepted the test for {result.accepted.join(', ')}. Check those inboxes and the attached PDF.</p> : null}
    {result?.failed.length ? <div className="form-error" role="alert">
      <p>The relay did not accept the test for:</p>
      <ul>{result.failed.map(({ recipient, code }) => <li key={recipient}>{recipient} ({code})</li>)}</ul>
      <p>Ask IT to check relay access, STARTTLS and the permitted sender address.</p>
    </div> : null}
  </section>;
}
