# Deploy the November address update

This release adds 112 addresses, including all 57 supplied Meadow Lake addresses, plus 13 matching Crowsnest town choices. There are 39,801 selectable choices. Existing choices are retained. Complaints use the same address suggestions as blocked calls and still accept manually entered addresses.

Run the following in an **elevated PowerShell window on CWS WEB01**. The application directory below is the existing deployment path; change it only if the CMReporting service uses a different startup directory.

The catalogue installer reads the existing production environment. It uses `CM_LOCATION_CATALOGUE_PATH` when configured, otherwise `CM_DATA_DIR\service-locations.json`. If either variable is supplied only through NSSM, set the same variable in this PowerShell session first. The `--check` output shows the exact destination before the service is stopped.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\inetpub\apps\Ronak\CM-Reporting'
if (git status --porcelain --untracked-files=no) {
    throw 'Resolve local tracked Git changes before deploying.'
}
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git pull failed.' }

node .\scripts\install-service-catalogue.mjs --check
if ($LASTEXITCODE -ne 0) { throw 'Catalogue check failed; the service is still running.' }

Stop-Service -Name CMReporting
(Get-Service CMReporting).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed; CMReporting is stopped.' }
$env:NEXT_PUBLIC_BASE_PATH = '/cm-reporting'
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; CMReporting is stopped.' }

node .\scripts\install-service-catalogue.mjs --apply
if ($LASTEXITCODE -ne 0) { throw 'Catalogue installation failed; CMReporting is stopped.' }
npm.cmd run server:check
if ($LASTEXITCODE -ne 0) { throw 'Server configuration check failed; CMReporting is stopped.' }

Start-Service -Name CMReporting
(Get-Service CMReporting).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
Start-Sleep -Seconds 3
Get-Service CMReporting
curl.exe --fail --max-time 20 -I 'https://automation.collectivewaste.ca/cm-reporting/login'
if ($LASTEXITCODE -ne 0) { throw 'The public login check failed; inspect the CMReporting service logs.' }
```

The installer checks that the current catalogue's addresses and streets are retained, backs up the current catalogue and audit under `catalogue-backups` beside the installed catalogue, and replaces the two files with the reviewed versions. It refuses an update that would remove or change an installed choice. An already-current installation is safe to run again. The reporting database, authentication database, photos and environment files are not changed. No database migration is needed.

After restarting, refresh the app and check **Brooks → 37 Meadow Lake Gate E** in a blocked call and a complaint. Also confirm that a complaint can still use a manually entered address. The server check should report **39,801 addresses**. Git push and a local build do not establish that these server steps have completed.

If an installation fails, the command reports the catalogue backup location. Keep the service stopped until the error is resolved. If restoring a catalogue backup, copy its `service-locations.json` to the configured destination (including any custom filename), and its audit back beside it before restarting.
