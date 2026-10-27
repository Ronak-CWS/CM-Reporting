# Driver access to blocked-call reporting

Drivers use `https://automation.collectivewaste.ca/cm-reporting/blocked-call`. The page redirects to `/cm-reporting/blocked-call/login`, where one shared password opens the form. Microsoft accounts and driver names are not required for this flow. Submissions are labeled **Driver** by the server. The form removes names remembered by an earlier version and does not collect or save a personal name.

For **Oops! tag**, drivers may enter a reason or leave it blank. Any entered reason appears in the review and is saved with the tag reason in reports.

## Test locally

Create or update the ignored `C:\Projects\CM-reporting\app\.env.local` with these local settings:

```dotenv
CM_AUTH_MODE=microsoft
NEXT_PUBLIC_BASE_PATH=/cm-reporting
CM_PUBLIC_ORIGIN=http://localhost:3000
CM_DRIVER_LOGIN_PASSWORD=local-driver-test-only
CM_GUEST_LOGIN_ENABLED=false
REPORT_EMAIL_ENABLED=false
CM_DATA_DIR=C:/Projects/CM-reporting/app/.local-data/driver-test
CM_LOCATION_CATALOGUE_PATH=C:/Projects/CM-reporting/app/data/service-locations.json
```

`local-driver-test-only` is a local test password. Choose a separate private password for the server. Existing environment variables in the PowerShell session take precedence over this file.

Start in PowerShell:

```powershell
Set-Location 'C:\Projects\CM-reporting\app'
npm.cmd run dev -- --port 3000
```

Dependencies are already installed in this checkout; use `npm.cmd ci` first on a fresh checkout. Open `http://localhost:3000/cm-reporting/blocked-call` and enter the local password. Select a community/location and reason, attach a photo, and submit without entering a name. Confirm the receipt, then sign out and confirm the password is required again. Opening `/cm-reporting/` with only a driver session should lead to the office sign-in page. The driver flow works without Entra credentials; office Microsoft sign-in still requires its configuration.

Reports, photos and sessions stay in `.local-data/driver-test`. Email is disabled for this configuration. Keep `CM_AUTH_MODE=microsoft` when checking that driver sessions cannot access office reporting. Use the exact localhost URL above so the form origin matches the configured origin. Stop the development process with Ctrl+C; restart it after changing the environment file.

## Server configuration

In the server's private `C:\inetpub\apps\Ronak\CM-Reporting\.env.production.local`, configure:

```dotenv
CM_AUTH_MODE=microsoft
CM_DRIVER_LOGIN_PASSWORD="<replace-with-your-private-driver-password>"
CM_GUEST_LOGIN_ENABLED=false
```

Replace the placeholder with a private password of 12 to 128 characters. Keep the Microsoft tenant, client ID, client secret and public origin configured for office access. Keep one entry per variable. If NSSM sets these variables in its service environment, update those values there because they take precedence over the file. No password is included in source control or sent to the browser.

The first installation requires deploying this updated code, building it, and restarting `CMReporting`; use the [reporting deployment procedure](reporting-update.md) once the code is available on the server. The Microsoft callback and IIS routing stay the same. After that initial deployment, changing only the driver password requires a service restart, without rebuilding:

```powershell
Restart-Service -Name CMReporting
Get-Service -Name CMReporting
```

Run those commands in an elevated PowerShell window on the application server.

## Access and session behavior

- The shared password has no scheduled expiry. Each browser receives a separate, private 12-hour session; activity does not extend it. Sessions survive a service restart with the same configuration.
- Driver access permits the blocked-call form, location searches and blocked-call submissions with photos. It does not grant dashboard, report-list, complaint, update, stored-photo download or export access. The driver receives only a submission receipt, including when retrying a submission.
- Submitted reports, photos and notification emails use the existing storage and email settings. Office staff see them in the normal reporting dashboard.
- Office users can still create blocked calls from inside the dashboard using their Microsoft identity. The standalone `/blocked-call` page uses the driver password even if that browser also has an office session. The cookies are separate, and driver sign-out preserves an office session.
- An expired driver session offers password sign-in in a new tab so the unfinished report and photos remain in the original tab. After signing in, choose **Check sign-in** and retry submission.
- Ten unsuccessful attempts temporarily block password attempts for five minutes across users. The limit survives restarts and cannot be reset using forwarding headers. Successful sign-ins clear the failed-attempt counter so normal shift logins do not consume the allowance.
- Change the password and restart to reject sessions created with the old password. Clear `CM_DRIVER_LOGIN_PASSWORD` and restart to disable driver access entirely.
- `CM_GUEST_LOGIN_ENABLED` is the older temporary login for the entire app. Leave it `false` when office access should require Microsoft sign-in; it is independent of the driver password.

## Deployment verification

Use a private browser window with no Microsoft session. Open the driver URL, enter the password, complete a report with a photo, and verify the receipt. Confirm an office user can see that report labeled **Driver** and its photo. In the driver window, opening `/cm-reporting/` should ask for office sign-in, and the records, stored-photo and export APIs should reject the driver session. Confirm driver sign-out returns to the driver login page. Use the normal operational process for any live test report because notification emails may be enabled.
