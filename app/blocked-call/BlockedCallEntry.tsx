'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { appPath } from '../../lib/app-path.js';
import BlockedCallWizard from '../components/BlockedCallWizard';

export default function BlockedCallEntry() {
  const router = useRouter();
  const exiting = useRef(false);
  const [error, setError] = useState('');
  async function signOut() {
    if (exiting.current) return;
    exiting.current = true;
    setError('');
    try {
      const response = await fetch(appPath('/api/auth/driver/logout'), { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out failed.');
      // Next's client router adds the configured base path itself.
      router.replace('/blocked-call/login?loggedOut=1');
    } catch {
      exiting.current = false;
      setError('Could not sign out. Please try again.');
    }
  }
  return <>
    <BlockedCallWizard reporterName="" driverMode onClose={() => void signOut()} />
    {error ? <aside className="session-notice" role="alert">{error}</aside> : null}
  </>;
}
