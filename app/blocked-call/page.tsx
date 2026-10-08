import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessFailure, reportAuthorName } from '../../lib/request-access';
import { withReturnTo } from '../../lib/auth-navigation';
import BlockedCallEntry from './BlockedCallEntry';

export const dynamic = 'force-dynamic';

export default async function BlockedCallPage() {
  const request = new Request('http://localhost/blocked-call', { headers: await headers() });
  if (accessFailure(request)) redirect(withReturnTo('/login', '/blocked-call'));
  return <BlockedCallEntry reporterName={reportAuthorName(request)} />;
}
