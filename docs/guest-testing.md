# Temporary guest access

Guest login is available again as a temporary fallback while Microsoft access is being resolved. It uses the same private server password as before. Microsoft sign-in remains available and `CM_AUTH_MODE` stays `microsoft`; the Entra registration settings must still be configured.

The guest account can use the shared reports, photos, updates, and Excel/CSV exports. Its submissions use the normal reporting database and notification settings. The dashboard labels this as a temporary guest session, and blocked-call submissions are attributed to **Guest user**.

## Restore on the Windows server

1. Open `C:\inetpub\apps\Ronak\CM-Reporting\.env.production.local` privately on the server.
2. Keep the existing `CM_GUEST_LOGIN_PASSWORD` value exactly as it is. If it was removed, restore the original value from your private configuration backup; it is not stored in Git.
3. Set `CM_GUEST_LOGIN_ENABLED=true` and ensure `CM_GUEST_LOGIN_EXPIRES_AT` contains a future UTC timestamp. Keep one entry per variable. If NSSM also sets these variables, update those values instead; service environment variables take precedence over the file.
4. Pull, install dependencies, rebuild, and restart using the [reporting deployment commands](reporting-update.md). The `npm.cmd ci` step installs the Excel export dependency when updating an older deployment.

To obtain an expiry three days from now without displaying or changing the password, run:

```powershell
(Get-Date).ToUniversalTime().AddDays(3).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
```

Copy that timestamp into `CM_GUEST_LOGIN_EXPIRES_AT` if the previous access window has ended. This does not change the password.

After deployment, confirm the `CMReporting` service is running and the local login check returns HTTP 200. Open `https://automation.collectivewaste.ca/cm-reporting/login`, enter the original guest password, and select **Guest login**. Direct links to `/cm-reporting/blocked-call` return to that form after guest sign-in. No IIS or shared ARR changes are needed.

Previously retired guest cookies remain invalid. Users sign in again with the original password. Existing Microsoft sessions keep their normal expiry.

## Expiry and disabling access

- Guest access is disabled by default and needs all three server settings. The existing password must meet the original 20-to-128-character requirement.
- Each guest session lasts at most one hour and never outlives `CM_GUEST_LOGIN_EXPIRES_AT`.
- At the deadline, the guest button disappears and guest sessions stop working. Microsoft sign-in remains available.
- The shared account allows ten sign-in attempts per five-minute window across all users. The limit persists across service restarts.
- Changing the password or expiry invalidates existing guest sessions after restart. Extending the expiry alone does not require a new password.
- To close guest access, set `CM_GUEST_LOGIN_ENABLED=false` and restart `CMReporting`. Existing guest sessions are then rejected. Environment-only changes do not require rebuilding.

Guest login does not resolve a Microsoft permission issue. Use [Microsoft SSO diagnostics](microsoft-sso.md) to investigate the affected employee's sign-in separately.
