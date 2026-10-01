# Windows server installation

The application is prepared for one company Windows server. The server itself has not been configured or started by this change. Keep the live SQLite database on the server's local disk, outside SMB/network shares. Backups can be copied to the company's existing backup system.

## Application and persistent data

Use separate application and data directories, for example:

```text
C:\Apps\CMReporting\app\                 application, dependencies and .next build
D:\CMReportingData\reports.sqlite        reports and photo metadata
D:\CMReportingData\photos\reports\...   original images
D:\CMReportingData\service-locations.json
D:\CMReportingData\service-locations-audit.json
```

Keep data outside the application, IIS web root and generated outputs. Grant Modify access only to the application service account and administrators/backup accounts that need it. Do not expose the photo or database folder as an IIS virtual directory. Preserve it through upgrades. SQLite WAL/SHM files are normal; never remove them while the application is running.

Install Node 24.15 or later and copy the application. Transfer the generated private catalogue and audit separately; they are excluded from Git. SQLite tables are initialized on first use. No test reports are installed. Authentication uses a separate `auth.sqlite` database in the private data directory.

## Microsoft sign-in and environment

Complete [SmartLayer's Entra setup](microsoft-sso.md). The production address is `https://automation.collectivewaste.ca/cm-reporting/`; its Web callback ends in `/cm-reporting/api/auth/microsoft/callback`.

Copy `.env.example` to `.env.production.local` in the application directory if it does not already exist. Restrict its ACL to the service account and administrators. Set these values, entering the secret locally:

```dotenv
CM_AUTH_MODE=microsoft
CM_PUBLIC_ORIGIN=https://automation.collectivewaste.ca
NEXT_PUBLIC_BASE_PATH=/cm-reporting
CM_PORT=3013
CM_DATA_DIR=D:\CMReportingData
CM_ENTRA_TENANT_ID=f0a98ba2-a706-40a0-9951-cf19d9778310
CM_ENTRA_CLIENT_ID=<client ID approved by SmartLayer for CM Reporting>
CM_ENTRA_CLIENT_SECRET=<new secret supplied securely>
CM_ENTRA_REQUIRED_ROLE=CMReporting.Access
```

The origin has no path or trailing slash. Do not transfer a development `.env.local` onto the server: it can override the production environment file. The catalogue defaults to `CM_DATA_DIR\service-locations.json`, unless `CM_LOCATION_CATALOGUE_PATH` overrides it.

After configuration, run from `C:\Apps\CMReporting\app`:

```powershell
npm.cmd ci
npm.cmd run server:check
npm.cmd run build
```

The configuration check verifies authentication, private storage and the catalogue without starting a server. The build embeds `/cm-reporting` in browser URLs; rebuild if it changes. Production rejects missing credentials and the development authentication bypass.

## IIS reverse proxy

This follows TRUX's HTTPS IIS/ARR and managed loopback Node pattern. CM Reporting uses Next.js, so **all pages, APIs and assets** go to Node; there is no static `frontend/dist` installation. [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting).

1. Confirm the existing HTTPS binding/certificate for `automation.collectivewaste.ca`, installed URL Rewrite and ARR, and server-level ARR proxying.
2. Add an IIS application: alias `cm-reporting`, physical path `C:\Apps\CMReporting\app\deploy\iis`, application pool No Managed Code. Grant the pool read access to that folder. Keep source, credentials, databases and photos outside the IIS content directory.
3. The supplied `deploy\iis\web.config` proxies everything to `http://127.0.0.1:3013/cm-reporting/`, retaining the prefix exactly once and forwarding query strings. Next's automatic trailing-slash redirects are disabled so IIS's application-directory redirect cannot loop. If 3013 is occupied, change both `CM_PORT` and the rewrite target.
4. Enable Anonymous Authentication **for this application** and disable its IIS Windows/Basic Authentication. The app handles Microsoft authentication, so login/callback must be reachable before sign-in. Preserve sibling IIS applications' settings.
5. Preserve the browser Origin and public Host, with correct forwarded HTTPS metadata. Review ARR `preserveHostHeader` for this deployment without disrupting siblings. Auth callbacks use the configured public origin. Strip incoming browser-supplied `x-middleware-*` headers.
6. Disable IIS/ARR output caching for this app. Preserve `Cache-Control: private, no-store`, `Set-Cookie`, redirects and error responses. Configure at least 120 seconds for upload proxy timeouts; the supplied limit is 32 MiB for the existing 30 MB photo policy.
7. Keep the Node port inaccessible externally; the listener binds to `127.0.0.1`. Omit callback query strings from IIS logs and do not log authentication bodies or credentials.

Microsoft mode needs no shared proxy key or identity headers. Allow outbound HTTPS from Node to Microsoft's discovery, token and signing-key endpoints. Keep the Windows clock synchronized.

## Managed Windows service

Configure NSSM or the approved service manager:

```text
Service name:      CMReporting
Application:       C:\Program Files\nodejs\node.exe
Startup directory: C:\Apps\CMReporting\app
Arguments:         scripts\start-server.mjs
Startup type:      Automatic
```

Use an approved service identity with read access to app/configuration and Modify access to private data and log directories. Configure stdout/stderr outside the web root, rotation, restart on failure, and termination of the child process tree when stopping the service. The entry point validates configuration every launch, checks the build's base path, then runs Next on loopback. No interactive terminal or npm in the service PATH is needed.

For a manual server check, run `npm.cmd start`. Stop that instance before starting the service; run only one instance. No service is installed, started or restarted by this code change.

Check `curl.exe -I http://127.0.0.1:3013/cm-reporting/login` locally, then open the final HTTPS login through IIS. The public login page is intentional; unauthenticated `/cm-reporting/api/records` must return 401. Verify a real assigned-employee login before declaring deployment complete. Updates require reinstalling locked dependencies when changed, rebuilding, and restarting this service while preserving the environment/data.

The former gateway integration remains available only through explicit `CM_AUTH_MODE=proxy`: authenticate employees at the gateway and overwrite `X-CM-User` and `X-CM-Proxy-Key` with the verified identity and random secret matching `CM_TRUSTED_PROXY_KEY` (at least 32 characters). Microsoft mode never falls back to these headers.

## Backup and restoration

Run from the app directory using the same environment or `.env.production.local` configuration as the service. Choose a new destination for each backup; its parent directory must exist and existing destinations are refused.

```powershell
npm.cmd run storage:backup -- 'E:\CMReportingBackups\2026-09-24-1800'
npm.cmd run storage:verify -- 'E:\CMReportingBackups\2026-09-24-1800'
```

Backup may run while the application is online. A SQLite snapshot determines which immutable original files belong in the backup. A completed folder contains `reports.sqlite`, its referenced `photos` tree, `service-locations.json` and `backup-manifest.json`. Retain the catalogue audit separately with the approved import. A folder without a manifest is incomplete. Missing images or size mismatches fail the backup; verification checks hashes for the database, catalogue and every image. [Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options).

Schedule backups with the company's existing service/Task Scheduler process and retention policy. Keep another copy on a second company-controlled disk or backup system. Do not copy only the live `.sqlite` file while it uses WAL. Back up the gateway settings and secrets separately using the company's configuration/credential backup process.

To restore, verify the backup, stop the app service, and copy the whole verified backup into a **new empty private folder**. Point `CM_DATA_DIR` there and update/remove any catalogue override. Retain the original live folder for rollback. Restart manually, check report counts and original photo downloads, and submit a test report. Never restore over an open database.

## Deployment checks

- Verify unauthenticated requests are denied for the app, records, exports and a known photo URL. Browser-supplied identity headers must not bypass authentication.
- Sign in as an allowed employee, submit a report with photos, restart the app service, and verify the record and original downloads remain available.
- Check Take photo on actual driver phones over HTTPS, including permission refusal and retry. Mocked camera tests cannot verify the OS handoff.
- If the earlier hosted D1/R2 instance contains records, export and reconcile them and **all original photos** before changing the driver URL. This implementation does not fetch or migrate hosted data. Preserve record IDs, submission hashes and storage keys, then verify totals and representative downloads after importing.

No cloud image service is required. Images remain ordinary server files with generated names, linked through SQLite metadata.
