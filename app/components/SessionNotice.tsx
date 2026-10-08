'use client';

import { useEffect, useState } from 'react';
import { appPath } from '../../lib/app-path.js';
import { SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT } from '../../lib/reporting-fetch';

export default function SessionNotice() {
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const show = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, show);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, show);
  }, []);

  async function checkSession() {
    setChecking(true);
    try {
      const result = await fetch(appPath('/api/auth/session'), { cache: 'no-store' });
      if (result.ok) {
        const session = await result.json() as { user?: { name?: unknown } };
        window.dispatchEvent(new CustomEvent(SESSION_RESTORED_EVENT, { detail: session.user?.name }));
        setExpired(false); setMessage('');
      }
      else setMessage('Please finish signing in, then check again.');
    } catch { setMessage('Could not check sign-in. Please try again.'); }
    finally { setChecking(false); }
  }

  if (!expired) return null;
  return <aside className="session-notice" role="alert" aria-label="Sign-in required">
    <p>Your session has ended. Sign in in a new tab, then return here and retry. Your current form entries are still here.</p>
    <div><a className="text-button" href={appPath('/login')} target="_blank" rel="noopener noreferrer">Sign in again (new tab)</a>
      <button className="text-button" type="button" disabled={checking} onClick={() => void checkSession()}>{checking ? 'Checking…' : 'Check sign-in'}</button></div>
    {message ? <p>{message}</p> : null}
  </aside>;
}
