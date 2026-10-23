# Deploy the reporting update

This update removes temporary guest access, adds formatted Excel exports, and updates the registers to query records in batches of 50. Microsoft sign-in configuration and callback URLs stay the same.

Run the following in an elevated PowerShell window on the application server, after this change is available on `origin/main`. It stops only the CMReporting service; other IIS applications are unaffected. The commands stop at the first failure and leave the service stopped if installation or compilation fails, so the build error can be resolved before starting it.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\inetpub\apps\Ronak\CM-Reporting'
if (git status --porcelain) { throw 'Resolve or back up local Git changes before deployment.' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git pull failed. Deployment stopped.' }

Stop-Service -Name CMReporting
(Get-Service CMReporting).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. CMReporting is stopped.' }
$env:NEXT_PUBLIC_BASE_PATH = '/cm-reporting'
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. CMReporting is stopped.' }
Start-Service -Name CMReporting
(Get-Service CMReporting).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
Start-Sleep -Seconds 3
Get-Service CMReporting
curl.exe --max-time 10 -I 'http://127.0.0.1:3013/cm-reporting/login'
```

`npm.cmd ci` is required for the new Excel export dependency. Private environment files, the reports database, authentication database and photos must be retained. No manual database migration or deletion is needed; the application creates the pagination indexes automatically.

The retired `CM_GUEST_LOGIN_ENABLED`, `CM_GUEST_LOGIN_PASSWORD` and `CM_GUEST_LOGIN_EXPIRES_AT` variables can be removed from the server environment. Leaving them set does not restore guest access. Old guest sessions must sign in through Microsoft. Existing Microsoft sessions keep their normal expiry.

After deployment, check the HTTPS login, complaint address column, optional customer name, priority and date filters, scrolling beyond 50 records, and both Excel downloads. A successful local build does not verify the IIS deployment.
