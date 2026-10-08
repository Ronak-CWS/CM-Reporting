'use client';

import { useRouter } from 'next/navigation';
import { appPath } from '../../lib/app-path.js';
import BlockedCallWizard from '../components/BlockedCallWizard';

export default function BlockedCallEntry({ reporterName }: { reporterName: string }) {
  const router = useRouter();
  return <BlockedCallWizard reporterName={reporterName} onClose={() => router.push(appPath('/'))} />;
}
