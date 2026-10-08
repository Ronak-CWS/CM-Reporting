'use client';

import { useRouter } from 'next/navigation';
import BlockedCallWizard from '../components/BlockedCallWizard';

export default function BlockedCallEntry({ reporterName }: { reporterName: string }) {
  const router = useRouter();
  // Next's client router adds the configured /cm-reporting base path itself.
  return <BlockedCallWizard reporterName={reporterName} onClose={() => router.push('/')} />;
}
