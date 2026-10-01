import { NextResponse } from 'next/server';
import { appPath, basePath } from './app-path.js';
import { FLOW_COOKIE, FLOW_SECONDS, microsoftConfig, SESSION_COOKIE, SESSION_SECONDS } from './auth-config';
import { consumeLoginFlow, createSession, deleteLoginFlow, deleteSession, saveLoginFlow } from './auth-store';
import { AccessDenied, beginMicrosoftLogin, completeMicrosoftLogin } from './microsoft-identity';
import { mutationFailure, requestCookie } from './request-access';

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
  try {
    const { flow, location } = await beginMicrosoftLogin();
    deleteLoginFlow(requestCookie(request, FLOW_COOKIE));
    const response = redirect(location);
    setCookie(response, FLOW_COOKIE, saveLoginFlow(flow), FLOW_SECONDS);
    return response;
  } catch {
    // Do not log provider errors: they can contain codes, tokens, or request credentials.
    return redirect(appPath('/login?error=unavailable'));
  }
}

export async function microsoftCallback(request: Request) {
  let response: NextResponse;
  try {
    const settings = microsoftConfig();
    const url = new URL(request.url);
    if (url.searchParams.getAll('state').length !== 1) throw new Error('Invalid sign-in transaction.');
    const flow = consumeLoginFlow(requestCookie(request, FLOW_COOKIE), url.searchParams.get('state') || '');
    if (!flow) throw new Error('Expired sign-in transaction.');
    const user = await completeMicrosoftLogin(url.search, flow);
    // A successful login rotates any previous session rather than adopting browser input.
    deleteSession(requestCookie(request, SESSION_COOKIE));
    response = redirect(appPath('/'));
    setCookie(response, SESSION_COOKIE, createSession(user, settings.policy), SESSION_SECONDS);
  } catch (error) {
    response = redirect(appPath(`/login?error=${error instanceof AccessDenied ? 'access' : 'signin'}`));
  }
  setCookie(response, FLOW_COOKIE, '', 0);
  return response;
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
