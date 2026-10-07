import * as oidc from 'openid-client';
import { GUID, microsoftConfig } from './auth-config';
import type { LoginFlow, SignedInUser } from './auth-store';

let cached: { key: string; config: Promise<oidc.Configuration> } | undefined;

async function provider() {
  const settings = microsoftConfig();
  const key = JSON.stringify([settings.issuer, settings.clientId, settings.clientSecret]);
  if (cached?.key !== key) {
    const config = oidc.discovery(new URL(settings.issuer), settings.clientId,
      { id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretPost(settings.clientSecret),
      { timeout: 10, execute: [oidc.enableNonRepudiationChecks] });
    cached = { key, config };
    // A temporary discovery failure must not poison all subsequent sign-in attempts.
    void config.catch(() => { if (cached?.config === config) cached = undefined; });
  }
  return cached.config;
}

export async function beginMicrosoftLogin() {
  const settings = microsoftConfig();
  const flow: LoginFlow = {
    state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(),
    policy: settings.policy, redirectUri: settings.redirectUri,
  };
  const location = oidc.buildAuthorizationUrl(await provider(), {
    redirect_uri: settings.redirectUri, scope: 'openid profile email', response_mode: 'query',
    code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier), code_challenge_method: 'S256',
    state: flow.state, nonce: flow.nonce,
  });
  return { flow, location: location.href };
}

type AccessDenialReason =
  | 'tenant_mismatch' | 'object_id_invalid' | 'subject_invalid'
  | 'member_claim_missing' | 'guest_account' | 'member_claim_invalid'
  | 'app_role_missing' | 'signin_configuration_changed';

export class AccessDenied extends Error {
  constructor(readonly reasons: AccessDenialReason[], readonly requiredRole: string) {
    super('Microsoft account does not meet CM Reporting access requirements.');
    this.name = 'AccessDenied';
  }
}

// Only call this with claims returned by the validating OIDC code exchange below.
export function employeeFromClaims(claims: Record<string, unknown>): SignedInUser {
  const { tenantId, requiredRole } = microsoftConfig();
  const reasons: AccessDenialReason[] = [];
  const objectId = typeof claims.oid === 'string' ? claims.oid : '';
  if (claims.tid !== tenantId) reasons.push('tenant_mismatch');
  if (!GUID.test(objectId)) reasons.push('object_id_invalid');
  if (typeof claims.sub !== 'string' || !claims.sub) reasons.push('subject_invalid');
  // acct is an Entra optional ID-token claim: 0 = member, 1 = guest. Missing claims fail closed.
  if (claims.acct === undefined) reasons.push('member_claim_missing');
  else if (claims.acct === 1 || claims.acct === '1') reasons.push('guest_account');
  else if (claims.acct !== 0 && claims.acct !== '0') reasons.push('member_claim_invalid');
  if (!Array.isArray(claims.roles) || !claims.roles.includes(requiredRole)) reasons.push('app_role_missing');
  // Report every failed check together, using fixed reason codes only. Do not
  // retain claims, tokens, names, emails or identifiers in diagnostic errors.
  if (reasons.length) throw new AccessDenied(reasons, requiredRole);
  const displayText = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : '';
  return {
    tenantId, objectId: objectId.toLowerCase(), name: displayText(claims.name) || 'Collective Waste employee',
    // This is display-only; access decisions and durable identity never use email/UPN.
    username: displayText(claims.preferred_username) || displayText(claims.email),
  };
}

export async function completeMicrosoftLogin(search: string, flow: LoginFlow) {
  const settings = microsoftConfig();
  if (flow.policy !== settings.policy || flow.redirectUri !== settings.redirectUri) {
    throw new AccessDenied(['signin_configuration_changed'], settings.requiredRole);
  }
  // Construct the callback from configuration, never from Host or forwarded headers.
  const callback = new URL(settings.redirectUri);
  callback.search = search;
  const tokens = await oidc.authorizationCodeGrant(await provider(), callback, {
    pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
  });
  const user = employeeFromClaims(tokens.claims()!);
  // Access/refresh/ID tokens are not returned to the browser or retained in the session store.
  return user;
}
