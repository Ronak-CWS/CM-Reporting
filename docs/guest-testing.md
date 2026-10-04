# Temporary guest testing

Use this only while approved testers are waiting for Microsoft Entra admin consent. The existing Microsoft login remains available, and `CM_AUTH_MODE` stays `microsoft`. The Entra registration settings must still be configured.

Guest access is disabled by default. When enabled, the login page shows a **Guest password** field and **Guest login** button. The shared test account can use reports, photo evidence, updates and CSV exports. Submissions are saved in the normal private data folder and use the normal notification settings; this is not a separate sandbox. The app labels the guest session and shows whether submissions send notification emails.

## Enable on the Windows server

In Administrator PowerShell, pull and rebuild from the actual server application directory. Stop on any failed command; a successful build does not mean a failed pull was applied.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\inetpub\apps\Ronak\CM-Reporting'
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git pull failed. Leave local changes in place and resolve the error first.' }
    Stop-Service CMReporting
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. Read the build error before starting the service.' }
}
```

Open `.env.production.local` and add or update these three settings. Keep only one entry for each variable. Do not commit this file.

```dotenv
CM_GUEST_LOGIN_ENABLED=true
CM_GUEST_LOGIN_PASSWORD=<paste-a-private-random-password>
CM_GUEST_LOGIN_EXPIRES_AT=<paste-the-UTC-expiry>
```

Generate a random password and an expiry three days from now in the same PowerShell window. These commands display the values only in that terminal; share the password privately with the approved testers.

```powershell
node.exe -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url') + '\n')"
(Get-Date).ToUniversalTime().AddDays(3).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
notepad.exe .env.production.local
```

Use the generated values in place of the placeholders, save and close Notepad, then check the configuration and start the service:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\inetpub\apps\Ronak\CM-Reporting'
    npm.cmd run server:check
    if ($LASTEXITCODE -ne 0) { throw 'Server configuration check failed. Correct the reported setting first.' }
    Start-Service CMReporting
    Start-Sleep -Seconds 5
    Get-Service CMReporting
    curl.exe --max-time 10 -I http://127.0.0.1:3013/cm-reporting/login
}
```

Confirm the service is running and the local login returns HTTP 200. Then open `https://automation.collectivewaste.ca/cm-reporting/login`, enter the shared password and click **Guest login**. Confirm the dashboard shows **Guest test session**. No IIS or shared ARR changes are required for this feature.

## Expiry and removal

- Passwords must be 20 to 128 characters. Use a newly generated password rather than reusing any company credential.
- Each guest session lasts at most one hour and never outlives `CM_GUEST_LOGIN_EXPIRES_AT`.
- At the UTC deadline, the guest button disappears and guest sessions stop working automatically. The app and Microsoft sign-in continue running.
- The shared account allows ten sign-in attempts per five-minute window across all testers. The limit persists across service restarts; wait five minutes if it is reached.
- Changing the password or testing deadline invalidates existing guest sessions after the service restarts. Share the new password privately if extending testing.
- To close access early, set `CM_GUEST_LOGIN_ENABLED=false`, remove the guest password and expiry, and run `Restart-Service CMReporting`. This blocks existing guest sessions and removes the button. No rebuild is needed for environment-only changes.

Guest login does not verify Microsoft SSO, MFA, employee assignment or the callback. SmartLayer must still review and grant the app's authentication permissions in Entra and configure the employee access role/claims described in [Microsoft SSO setup](microsoft-sso.md). Retest **Sign in with Microsoft** after they finish.
