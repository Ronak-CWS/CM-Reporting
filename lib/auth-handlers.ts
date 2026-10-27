import { NextResponse } from 'next/server';
import { appPath, basePath } from './app-path.js';
import { driverLoginConfig, DRIVER_SESSION_COOKIE, DRIVER_SESSION_SECONDS, FLOW_COOKIE, FLOW_SECONDS, guestLoginConfig, GUEST_SESSION_SECONDS, microsoftConfig, SESSION_COOKIE, SESSION_SECONDS } from './auth-config';
import { clearPasswordLoginAttempts, consumeLoginFlow, createSession, deleteLoginFlow, deleteSession, saveLoginFlow, takePasswordLoginAttempt } from './auth-store';
import { AccessDenied, beginMicrosoftLogin, completeMicrosoftLogin } from './microsoft-identity';
import { mutationFailure, requestCookie } from './request-access';
import { safeReturnTo, withReturnTo } from './auth-navigation';
import { passwordMatches } from './password-login';

function redirect(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
}

function setCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production' || (process.env.CM_PUBLIC_ORIGIN || '').startsWith('https:'),
    sameSite: 'lax', path: basePath() || '/', maxAge,
  });
}

export async function startMicrosoftLogin(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
  try {
    const { flow, location } = await beginMicrosoftLogin(returnTo);
    deleteLoginFlow(requestCookie(request, FLOW_COOKIE));
    const response = redirect(location);
    setCookie(response, FLOW_COOKIE, saveLoginFlow(flow), FLOW_SECONDS);
    return response;
  } catch {
    // Do not log provider errors: they can contain codes, tokens, or request credentials.
    return redirect(withReturnTo('/login?error=unavailable', returnTo));
  }
}

export async function microsoftCallback(request: Request) {
  let response: NextResponse;
  let returnTo = '/';
  try {
    const settings = microsoftConfig();
    const url = new URL(request.url);
    if (url.searchParams.getAll('state').length !== 1) throw new Error('Invalid sign-in transaction.');
    const flow = consumeLoginFlow(requestCookie(request, FLOW_COOKIE), url.searchParams.get('state') || '');
    if (!flow) throw new Error('Expired sign-in transaction.');
    returnTo = safeReturnTo(flow.returnTo);
    const user = await completeMicrosoftLogin(url.search, flow);
    // A successful login rotates any previous session rather than adopting browser input.
    deleteSession(requestCookie(request, SESSION_COOKIE));
    response = redirect(appPath(returnTo));
    setCookie(response, SESSION_COOKIE, createSession(user, settings.policy), SESSION_SECONDS);
  } catch (error) {
    if (error instanceof AccessDenied) {
      // Only our fixed access-check codes and configured role are safe to log.
      // Never serialize the error itself or any provider/request/token details.
      console.warn(`[CMReporting SSO] ${JSON.stringify({ event: 'access_denied', reasons: error.reasons, requiredRole: error.requiredRole || undefined })}`);
    }
    response = redirect(withReturnTo(`/login?error=${error instanceof AccessDenied ? 'access' : 'signin'}`, returnTo));
  }
  setCookie(response, FLOW_COOKIE, '', 0);
  return response;
}

export async function guestLogin(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
  const guestError = (error: string) => redirect(withReturnTo(`/login?error=${error}`, returnTo));
  try {
    if (request.method !== 'POST') return new NextResponse(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' } });
    const failure = mutationFailure(request);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status, headers: { 'Cache-Control': 'private, no-store' } });
    const settings = guestLoginConfig();
    if (!settings) return guestError('guest-unavailable');
    const retryAfter = takePasswordLoginAttempt(settings.policy);
    if (retryAfter) {
      const response = guestError('guest-rate');
      response.headers.set('Retry-After', String(retryAfter));
      return response;
    }
    if (!await passwordMatches(request, settings.passwordDigest)) return guestError('guest-signin');
    const maxAge = Math.min(GUEST_SESSION_SECONDS, settings.expiresAt - Math.floor(Date.now() / 1000));
    if (maxAge <= 0) return guestError('guest-unavailable');
    deleteSession(requestCookie(request, SESSION_COOKIE));
    deleteLoginFlow(requestCookie(request, FLOW_COOKIE));
    const response = redirect(appPath(returnTo));
    const token = createSession({ kind: 'guest', name: 'Guest user', username: 'Temporary guest access' }, settings.policy, maxAge);
    setCookie(response, SESSION_COOKIE, token, maxAge);
    setCookie(response, FLOW_COOKIE, '', 0);
    return response;
  } catch {
    return guestError('guest-unavailable');
  }
}

export async function driverLogin(request: Request) {
  const driverError = (error: string) => redirect(appPath(`/blocked-call/login?error=${error}`));
  try {
    if (request.method !== 'POST') return new NextResponse(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' } });
    const failure = mutationFailure(request);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status, headers: { 'Cache-Control': 'private, no-store' } });
    const settings = driverLoginConfig();
    if (!settings) return driverError('unavailable');
    const retryAfter = takePasswordLoginAttempt(settings.policy);
    if (retryAfter) {
      const response = driverError('rate');
      response.headers.set('Retry-After', String(retryAfter));
      return response;
    }
    if (!await passwordMatches(request, settings.passwordDigest)) return driverError('signin');
    // Successful shift logins do not consume the shared failed-attempt allowance.
    clearPasswordLoginAttempts(settings.policy);
    deleteSession(requestCookie(request, DRIVER_SESSION_COOKIE));
    const response = redirect(appPath('/blocked-call'));
    const token = createSession({ kind: 'driver', name: 'Driver', username: 'Blocked-call reporting' }, settings.policy, DRIVER_SESSION_SECONDS);
    setCookie(response, DRIVER_SESSION_COOKIE, token, DRIVER_SESSION_SECONDS);
    return response;
  } catch {
    return driverError('unavailable');
  }
}

export async function driverLogout(request: Request) {
  try {
    if (request.method !== 'POST') return new NextResponse(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' } });
    const failure = mutationFailure(request);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status, headers: { 'Cache-Control': 'private, no-store' } });
    deleteSession(requestCookie(request, DRIVER_SESSION_COOKIE));
    const response = redirect(appPath('/blocked-call/login?loggedOut=1'));
    setCookie(response, DRIVER_SESSION_COOKIE, '', 0);
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign out is temporarily unavailable. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function logout(request: Request) {
  try {
    const failure = mutationFailure(request);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status, headers: { 'Cache-Control': 'private, no-store' } });
    deleteSession(requestCookie(request, SESSION_COOKIE));
    deleteLoginFlow(requestCookie(request, FLOW_COOKIE));
    const response = redirect(appPath('/login?loggedOut=1'));
    setCookie(response, SESSION_COOKIE, '', 0);
    setCookie(response, FLOW_COOKIE, '', 0);
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign out is temporarily unavailable. Please try again.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
