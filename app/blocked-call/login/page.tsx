import Image from 'next/image';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { appPath } from '../../../lib/app-path.js';
import { driverLoginConfig, publicOrigin } from '../../../lib/auth-config';
import { signedInDriver } from '../../../lib/request-access';

export const dynamic = 'force-dynamic';

const messages: Record<string, string> = {
  signin: 'The driver password was not accepted. Please try again.',
  unavailable: 'Driver sign-in is not available. Please contact the office.',
  rate: 'Too many unsuccessful attempts. Please wait five minutes before trying again.',
};

export default async function DriverLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let ready = false;
  let authenticated = false;
  try {
    ready = !!driverLoginConfig();
    authenticated = !!signedInDriver(new Request(`${publicOrigin()}${appPath('/blocked-call/login')}`, { headers: await headers() }));
  } catch { /* Keep configuration and infrastructure details private. */ }
  if (authenticated && params.loggedOut !== '1') redirect(`${publicOrigin()}${appPath('/blocked-call')}`);
  const error = typeof params.error === 'string' && Object.hasOwn(messages, params.error) ? messages[params.error] : '';
  return <main className="login-shell">
    <section className="login-card" aria-labelledby="driver-login-heading">
      <Image src={appPath('/collective-waste-solutions.png')} alt="Collective Waste Solutions" width={200} height={50} priority />
      <p className="eyebrow">Blocked-call reporting</p>
      <h1 id="driver-login-heading">Driver sign-in</h1>
      <p className="login-intro">Enter the driver password provided by the office to report a blocked call.</p>
      {params.loggedOut === '1' ? <p role="status" className="login-message">You have signed out.</p> : null}
      {error ? <p role="alert" className="login-message login-message--error">{error}</p> : null}
      {ready ? <form className="driver-signin" action={appPath('/api/auth/driver')} method="post">
        <label htmlFor="driver-password">Driver password</label>
        <input id="driver-password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
        <button className="button button--primary button--wide" type="submit">Open blocked-call form</button>
      </form> : <p role="status" className="login-message">Driver access is not available. Please contact the office.</p>}
      <p className="login-footnote"><a href={appPath('/login')}>Office reporting sign-in</a></p>
    </section>
  </main>;
}
