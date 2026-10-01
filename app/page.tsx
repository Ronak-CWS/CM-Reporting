import ReportingApp from './ReportingApp';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessFailure, signedInUser } from '../lib/request-access';
import { appPath } from '../lib/app-path.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const request = new Request('http://localhost/', { headers: await headers() });
  if (accessFailure(request)) redirect(appPath('/login'));
  return <ReportingApp user={signedInUser(request)} />;
}
