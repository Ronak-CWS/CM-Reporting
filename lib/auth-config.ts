import { createHash } from 'node:crypto';
import { appPath } from './app-path.js';

// Fixed Microsoft session lifetime; activity does not renew it.
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
export const GUEST_SESSION_SECONDS = 60 * 60;
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
  // All tenant members can sign in by default. Require an app role only when
  // the application owner and IT have explicitly configured one.
  const requiredRole = (process.env.CM_ENTRA_REQUIRED_ROLE || '').trim();
  if (!GUID.test(tenantId) || !GUID.test(clientId)) throw new Error('Set the Entra tenant and application client IDs.');
  if (clientSecret.length < 16 || clientSecret.startsWith('<')) throw new Error('Set the Entra client secret in the private server environment.');
  if (requiredRole && !/^[a-zA-Z0-9._-]{1,120}$/.test(requiredRole)) throw new Error('Set a valid Entra application access role or leave it blank for tenant members.');
  const origin = publicOrigin();
  return {
    tenantId, clientId, clientSecret, requiredRole, origin,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    redirectUri: `${origin}${appPath('/api/auth/microsoft/callback')}`,
    // Changing the registration or access policy also invalidates existing local sessions.
    policy: requiredRole ? `${tenantId}:${clientId}:${requiredRole}:member` : `${tenantId}:${clientId}:tenant-members`,
  };
}

export function guestLoginConfig() {
  const enabled = process.env.CM_GUEST_LOGIN_ENABLED || 'false';
  if (enabled === 'false') return null;
  if (enabled !== 'true') throw new Error('CM_GUEST_LOGIN_ENABLED must be true or false.');
  const microsoft = microsoftConfig();
  const password = process.env.CM_GUEST_LOGIN_PASSWORD || '';
  if (password.length < 20 || password.length > 128 || password.startsWith('<')) {
    throw new Error('Set CM_GUEST_LOGIN_PASSWORD to a private random password of 20 to 128 characters.');
  }
  const expiry = process.env.CM_GUEST_LOGIN_EXPIRES_AT || '';
  const expiresAt = Math.floor(Date.parse(expiry) / 1000);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry) || !Number.isFinite(expiresAt)) {
    throw new Error('Set CM_GUEST_LOGIN_EXPIRES_AT to an explicit UTC date and time, such as YYYY-MM-DDTHH:mm:ssZ.');
  }
  // An expired testing window disables guest access without stopping Microsoft sign-in.
  if (expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const passwordDigest = createHash('sha256').update(password).digest();
  return {
    passwordDigest, expiresAt,
    // Disable, expiry, password rotation or a registration change revokes guest sessions.
    policy: `guest:${createHash('sha256').update(JSON.stringify([
      microsoft.policy, microsoft.origin, appPath('/'), password, expiresAt,
    ])).digest('hex')}`,
  };
}

export function validateAuthenticationConfig() {
  const mode = authenticationMode();
  publicOrigin();
  if (mode === 'microsoft') microsoftConfig();
  guestLoginConfig();
  if (mode === 'proxy' && (process.env.CM_TRUSTED_PROXY_KEY || '').length < 32) {
    throw new Error('Set CM_TRUSTED_PROXY_KEY to a random secret of at least 32 characters shared only with the authenticated reverse proxy.');
  }
}
