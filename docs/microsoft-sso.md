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
| App role | Display name: CM Reporting access; value: `CMReporting.Access`; allowed member types: Users/Groups; enabled |
| Optional ID-token claim | `acct`; the app requires member value `0` and rejects guests/missing claims |
| Enterprise application | Assignment required: Yes; assign approved employees/groups to **CM Reporting access** |
| Implicit/hybrid grant checkboxes | Leave unchecked; authorization code with PKCE is used |

The business owner supplies the approved employee list. Email recipients are not automatically the access list. All assigned employees currently receive the existing reporting features; driver/office permissions are not separate in this app.

Enter the new CM Reporting client ID and secret in the private environment file using the approved secure channel. The previously shared Reports Dashboard secret has not been stored or used here. Coordinate its rotation with the Reports Dashboard owner before removing that app's old secret.

The app does not call Graph or require `User.Read`, `Directory.Read.All`, mail, files or calendar permissions. Sources: [Microsoft OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), [app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps), and [`acct` claim](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference).

## Local configuration

SSO testing is planned at the production HTTPS URL above; no localhost callback is needed for that plan. For local UI development, copy `.env.example` to `.env.local` in `C:\Projects\CM-reporting\app` if that file does not already exist. Set `CM_AUTH_MODE=development`, keep `CM_PUBLIC_ORIGIN=http://localhost:3000` and `NEXT_PUBLIC_BASE_PATH=/cm-reporting`, then start manually:

```powershell
npm.cmd run dev
```

Open `http://localhost:3000/cm-reporting/`. Production rejects the development authentication bypass. If local Microsoft sign-in is needed later, register the additional Web callback `http://localhost:3000/cm-reporting/api/auth/microsoft/callback`, configure the new app credentials locally, and switch to `CM_AUTH_MODE=microsoft`.

Follow [Windows installation](windows-server.md) for production. Never put credentials in `NEXT_PUBLIC_*` variables. The base path must be set before building; changes require rebuilding.

## Authentication and sessions

- The OIDC library validates signature, issuer, audience, expiry and nonce. Every login uses PKCE and one-time state bound to a browser cookie and ten-minute server transaction.
- Valid tokens also require the configured tenant, user object ID, member account claim and CM Reporting role. Identity uses tenant ID plus object ID; email/UPN is display-only.
- The browser receives an opaque random cookie scoped to `/cm-reporting`, with HttpOnly, SameSite=Lax and Secure over HTTPS. Private SQLite stores its hash and the employee identity. Microsoft tokens and client secrets are not retained in this database or returned to the browser.
- Local sessions last eight hours without sliding renewal and survive service restarts. Removing an Entra assignment prevents the next login; existing local sessions are not instantly revoked. For immediate revocation of **all** sessions, stop the service, remove only `auth.sqlite` and its `auth.sqlite-wal`/`auth.sqlite-shm` sidecars from the verified private data folder, then restart. Leave `reports.sqlite` and photos intact. Never restore the auth database from backup.
- Sign out revokes the current CM Reporting session. It leaves the Microsoft session available to other company apps. This app does not implement tenant-wide/front-channel logout or continuous access evaluation.
- Pages, records, autocomplete, photos and exports require authentication. Data handlers repeat the access check independently of Next's request proxy. Mutations and logout require the configured browser Origin.
- Provider errors are reduced to safe messages. Configure IIS logs to omit callback query strings, which contain short-lived authorization codes, and avoid logging authentication request/response bodies.

`auth.sqlite` is separate from the reporting backup and deliberately excluded. The previous gateway integration remains available through explicit `CM_AUTH_MODE=proxy`, with a gateway that overwrites verified identity/key headers. It is never a fallback when Microsoft login fails.

## Before enabling staff access

Automated tests use the real OIDC library with a mocked discovery/token/JWKS provider and RSA-signed tokens. They exercise invalid signatures/claims, unauthorized accounts, replay, cookie binding, expiry, logout, same-origin writes and direct data-route checks. They do not prove tenant settings, MFA/Conditional Access, or IIS behavior.

Test the final HTTPS URL with an assigned employee and an unassigned employee. Check the role/member claim, sign-out, a saved report, original photo downloads, exports and a service restart. Confirm requests stay under `/cm-reporting/api/`. Validate camera and Microsoft sign-in handoff on the actual drivers' phones.
