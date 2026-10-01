import Image from 'next/image';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { appPath } from '../../lib/app-path.js';
import { microsoftConfig, publicOrigin } from '../../lib/auth-config';
import { signedInUser } from '../../lib/request-access';

export const dynamic = 'force-dynamic';

const messages: Record<string, string> = {
  access: 'Your account does not have access to CM Reporting. Please ask the office to arrange access.',
  signin: 'Sign-in was cancelled, expired, or could not be verified. Please try again.',
  unavailable: 'Microsoft sign-in is temporarily unavailable. Please try again or contact the office.',
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let ready = false;
  let authenticated = false;
  try {
    microsoftConfig();
    ready = true;
    authenticated = !!signedInUser(new Request(`${publicOrigin()}${appPath('/login')}`, { headers: await headers() }));
  } catch { /* Configuration and infrastructure errors are never rendered to visitors. */ }
  if (authenticated && params.loggedOut !== '1') redirect(appPath('/'));
  const error = typeof params.error === 'string' && Object.hasOwn(messages, params.error) ? messages[params.error] : '';
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-heading">
        <Image src={appPath('/collective-waste-solutions.png')} alt="Collective Waste Solutions" width={200} height={50} priority />
        <p className="eyebrow">C9 &amp; Wood Buffalo</p>
        <h1 id="login-heading">CM Reporting</h1>
        <p className="login-intro">Sign in with your Collective Waste Microsoft account to access reports and submit blocked calls.</p>
        {params.loggedOut === '1' ? <p role="status" className="login-message">You have signed out of CM Reporting.</p> : null}
        {error ? <p role="alert" className="login-message login-message--error">{error}</p> : null}
        {!ready ? <p role="status" className="login-message">Microsoft sign-in is being set up. Please contact the office for access.</p> : (
          <a className="microsoft-signin" href={appPath('/api/auth/microsoft/start')}>
            <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden="true">
              <path fill="#f25022" d="M0 0h10v10H0z" /><path fill="#7fba00" d="M11 0h10v10H11z" />
              <path fill="#00a4ef" d="M0 11h10v10H0z" /><path fill="#ffb900" d="M11 11h10v10H11z" />
            </svg>
            Sign in with Microsoft
          </a>
        )}
        <p className="login-footnote">For authorized Collective Waste employees.</p>
      </section>
    </main>
  );
}
