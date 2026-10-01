import { appPath } from './app-path.js';

export const SESSION_SECONDS = 8 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
export const SESSION_COOKIE = 'cm_reporting_session';
export const FLOW_COOKIE = 'cm_reporting_login';
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authenticationMode() {
  const mode = process.env.CM_AUTH_MODE || 'microsoft';
  if (mode === 'microsoft' || mode === 'proxy') return mode;
  if (mode === 'development' && process.env.NODE_ENV !== 'production') return mode;
  throw new Error('CM_AUTH_MODE must be microsoft or proxy. Development bypass is forbidden in production.');
}

export function publicOrigin() {
  const value = process.env.CM_PUBLIC_ORIGIN || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
  try {
    const url = new URL(value);
    const local = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol === 'https:' || local) && url.origin === value && !url.username && !url.password) return value;
  } catch { /* Invalid configuration fails closed. */ }
  throw new Error('CM_PUBLIC_ORIGIN must be the HTTPS site origin, with no path or trailing slash. HTTP is allowed only for local development.');
}

export function microsoftConfig() {
  if (authenticationMode() !== 'microsoft') throw new Error('Microsoft sign-in is not enabled.');
  const tenantId = (process.env.CM_ENTRA_TENANT_ID || '').trim().toLowerCase();
  const clientId = (process.env.CM_ENTRA_CLIENT_ID || '').trim().toLowerCase();
  const clientSecret = process.env.CM_ENTRA_CLIENT_SECRET || '';
  const requiredRole = (process.env.CM_ENTRA_REQUIRED_ROLE || 'CMReporting.Access').trim();
  if (!GUID.test(tenantId) || !GUID.test(clientId)) throw new Error('Set the Entra tenant and application client IDs.');
  if (clientSecret.length < 16 || clientSecret.startsWith('<')) throw new Error('Set the Entra client secret in the private server environment.');
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(requiredRole)) throw new Error('Set a valid Entra application access role.');
  const origin = publicOrigin();
  return {
    tenantId, clientId, clientSecret, requiredRole, origin,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    redirectUri: `${origin}${appPath('/api/auth/microsoft/callback')}`,
    // Changing the registration or access policy also invalidates existing local sessions.
    policy: `${tenantId}:${clientId}:${requiredRole}:member`,
  };
}

export function validateAuthenticationConfig() {
  const mode = authenticationMode();
  publicOrigin();
  if (mode === 'microsoft') microsoftConfig();
  if (mode === 'proxy' && (process.env.CM_TRUSTED_PROXY_KEY || '').length < 32) {
    throw new Error('Set CM_TRUSTED_PROXY_KEY to a random secret of at least 32 characters shared only with the authenticated reverse proxy.');
  }
}
