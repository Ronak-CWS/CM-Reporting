# Microsoft sign-in for CM Reporting

The app signs employees in with Microsoft Entra using a server-side OpenID Connect authorization-code flow. Production URL: **https://automation.collectivewaste.ca/cm-reporting/**. This implementation has not changed the Entra tenant or deployed the Windows server.

## Settings for SmartLayer

Use a dedicated **single-tenant Web** registration for CM Reporting in the existing company tenant `f0a98ba2-a706-40a0-9951-cf19d9778310`. This gives CM Reporting its own client ID, credentials, and assignments while employees continue using their company Microsoft accounts.

| Entra setting | Required value |
| --- | --- |
| Supported accounts | Accounts in this organizational directory only |
| Platform | Web, with server-side code exchange |
| Production redirect URI | `https://automation.collectivewaste.ca/cm-reporting/api/auth/microsoft/callback` |
| Sign-in scopes | `openid profile email` |
| API access | No Graph data permissions, application permissions or offline access required |
| App role | Not required for the default tenant-member policy. Configure a role only if access is deliberately restricted by role. |
| Optional ID-token claim | `acct`; the app requires member value `0` and rejects guests/missing claims |
| Enterprise application | Permit the intended company-tenant members to sign in. Entra assignment and sign-in policies still apply independently of the app's optional role check. |
| Implicit/hybrid grant checkboxes | Leave unchecked; authorization code with PKCE is used |

The approved default population is every member account in the configured company tenant, including administrator or contractor accounts classified as members. Guests are rejected. Email recipients and email suffixes do not determine access. All admitted members currently receive the existing reporting features; driver/office permissions are not separate in this app.

In **App registrations > CM Reporting > Token configuration**, add the optional `acct` claim to the **ID token** (or configure it in the app manifest). The app requires Microsoft's member value `0`; guest value `1` and missing membership information remain rejected. This claim does not require access to mail, files or other Microsoft Graph data. See [Microsoft's optional-claim configuration](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims).

Enter the new CM Reporting client ID and secret in the private environment file using the approved secure channel. The previously shared Reports Dashboard secret has not been stored or used here. Coordinate its rotation with the Reports Dashboard owner before removing that app's old secret.

The app does not call Graph or require `User.Read`, `Directory.Read.All`, mail, files or calendar permissions. Sources: [Microsoft OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), [app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps), and [`acct` claim](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference).

## Local configuration

SSO testing is planned at the production HTTPS URL above; no localhost callback is needed for that plan. For local UI development, copy `.env.example` to `.env.local` in `C:\Projects\CM-reporting\app` if that file does not already exist. Set `CM_AUTH_MODE=development`, keep `CM_PUBLIC_ORIGIN=http://localhost:3000` and `NEXT_PUBLIC_BASE_PATH=/cm-reporting`, then start manually:

```powershell
npm.cmd run dev
```

Open `http://localhost:3000/cm-reporting/`. Production rejects the development authentication bypass. If local Microsoft sign-in is needed later, register the additional Web callback `http://localhost:3000/cm-reporting/api/auth/microsoft/callback`, configure the new app credentials locally, and switch to `CM_AUTH_MODE=microsoft`.

Follow [Windows installation](windows-server.md) for production. Never put credentials in `NEXT_PUBLIC_*` variables. The base path must be set before building; changes require rebuilding.

## Access policy and existing deployments

Leave `CM_ENTRA_REQUIRED_ROLE` blank or unset to allow all company-tenant members without a custom app role. For an existing server configuration, replace the old role value with:

```dotenv
CM_ENTRA_REQUIRED_ROLE=
```

Deploy the updated code, rebuild and restart the service. Earlier versions restore the mandatory `CMReporting.Access` default when this setting is empty, so changing the environment alone is not sufficient. If NSSM or the machine environment also defines this variable, clear the old value there. Switching access policies invalidates existing Microsoft and temporary guest sessions; users must sign in again. Report data is unaffected.

To deliberately restrict access later, set `CM_ENTRA_REQUIRED_ROLE` to the exact value of a role that IT has created and assigned. Nonempty values remain enforced along with tenant membership. `CMReporting.Access` is only an example custom role name, not a built-in Microsoft role.

## Authentication and sessions

- The OIDC library validates signature, issuer, audience, expiry and nonce. Every login uses PKCE and one-time state bound to a browser cookie and ten-minute server transaction.
- Valid tokens also require the configured tenant, user object ID and member account claim. An application role is checked only when explicitly configured. Identity uses tenant ID plus object ID; email/UPN is display-only.
- The browser receives an opaque random cookie scoped to `/cm-reporting`, with HttpOnly, SameSite=Lax and Secure over HTTPS. Private SQLite stores its hash and the employee identity. Microsoft tokens and client secrets are not retained in this database or returned to the browser.
- Local Microsoft sessions last seven days without sliding renewal and survive service restarts. The lifetime applies to new sign-ins; existing sessions retain the expiry saved when they were created. Entra account and assignment restrictions apply to subsequent Microsoft sign-ins as configured in Entra; existing local sessions are not instantly revoked. Changing the registration or configured application-role policy invalidates local sessions. For immediate revocation of **all** sessions, stop the service, remove only `auth.sqlite` and its `auth.sqlite-wal`/`auth.sqlite-shm` sidecars from the verified private data folder, then restart. Leave `reports.sqlite` and photos intact. Never restore the auth database from backup.
- Sign out revokes the current CM Reporting session. It leaves the Microsoft session available to other company apps. This app does not implement tenant-wide/front-channel logout or continuous access evaluation.
- Pages, records, autocomplete, photos and exports require authentication. Data handlers repeat the access check independently of Next's request proxy. Mutations and logout require the configured browser Origin.
- Provider errors are reduced to safe messages. Configure IIS logs to omit callback query strings, which contain short-lived authorization codes, and avoid logging authentication request/response bodies.

`auth.sqlite` is separate from the reporting backup and deliberately excluded. The previous gateway integration remains available through explicit `CM_AUTH_MODE=proxy`, with a gateway that overwrites verified identity/key headers. It is never a fallback when Microsoft login fails.

## Diagnosing a return to `login?error=access`

This redirect is generated by CM Reporting, not the Microsoft sign-in page. Successful Microsoft authentication and admin consent do not by themselves satisfy the app's membership check or any explicitly configured role check. A changed sign-in configuration during a pending login can also produce it.

The callback writes one `[CMReporting SSO]` warning to the server's stderr with all failed checks. It logs fixed reason codes and, when configured, the required role only. It does not log Microsoft tokens, authorization codes, callback URLs, secrets, email addresses, names or user identifiers. General provider errors remain unlogged.

After deploying the diagnostic change, start a fresh Microsoft sign-in attempt, then read the latest diagnostic on the Windows server:

```powershell
Get-Content -LiteralPath 'C:\CMReportingLogs\stderr.log' -Tail 100 |
  Select-String -SimpleMatch '[CMReporting SSO]' |
  Select-Object -Last 1
```

| Reason | What to check |
| --- | --- |
| `member_claim_missing` | The validated ID token omitted `acct`. Ask SmartLayer to include the optional `acct` claim in the CM Reporting **ID token**. Missing does not mean the account is a guest. |
| `guest_account` | The token identifies the account as a tenant guest (`acct=1`). Use the intended internal member account. |
| `member_claim_invalid` | The ID token has an unexpected account-type value. Review its claim configuration. |
| `app_role_missing` | A nonempty `CM_ENTRA_REQUIRED_ROLE` is still configured, and the token lacks that role. For the approved all-member policy, clear this setting and restart. For deliberate role restrictions, compare its exact value with the created role and user/group assignments. |
| `tenant_mismatch`, `object_id_invalid`, `subject_invalid` | Review the app registration, tenant configuration and identity claims. These identity checks remain required. |
| `signin_configuration_changed` | The configured registration, access policy or callback changed during this login. Start again from the login page using the current configuration. |

With a blank role setting, `member_claim_missing` is resolved by including `acct` in the ID token, not by creating an application role. Do not interpret a missing claim as a confirmed member or authorize by an email suffix.

## Before enabling staff access

Automated tests use the real OIDC library with a mocked discovery/token/JWKS provider and RSA-signed tokens. They exercise invalid signatures/claims, unauthorized accounts, replay, cookie binding, expiry, logout, same-origin writes and direct data-route checks. They do not prove tenant settings, MFA/Conditional Access, or IIS behavior.

Test the final HTTPS URL with a company-tenant member that has no custom app role, and confirm guest and other-tenant accounts remain denied. If a role is explicitly configured, also test assigned and unassigned accounts. Check the member claim, sign-out, a saved report, original photo downloads, exports and a service restart. Confirm requests stay under `/cm-reporting/api/`. Validate camera and Microsoft sign-in handoff on the actual drivers' phones.
