import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { driverAccessFailure } from '../../lib/request-access';
import { appPath } from '../../lib/app-path.js';
import { publicOrigin } from '../../lib/auth-config';
import BlockedCallEntry from './BlockedCallEntry';

export const dynamic = 'force-dynamic';

export default async function BlockedCallPage() {
  const request = new Request('http://localhost/blocked-call', { headers: await headers() });
  if (driverAccessFailure(request)) redirect(`${publicOrigin()}${appPath('/blocked-call/login')}`);
  return <BlockedCallEntry />;
}
