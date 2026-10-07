# CM Reporting

Private operations reporting for C9 and Wood Buffalo. The app now uses **SQLite records and a private photo folder on the company Windows server**. See [Windows server setup](docs/windows-server.md) for installation, access configuration, backups and restoration.

## Microsoft sign-in

Login now uses company Microsoft accounts through single-tenant Entra SSO. [Microsoft SSO setup](docs/microsoft-sso.md) lists SmartLayer's exact settings, scopes, employee assignments and callbacks. Production URL: `https://automation.collectivewaste.ca/cm-reporting/`.

Copy `.env.example` to a private environment file and configure the dedicated CM Reporting registration and a new client secret. The template contains the company tenant ID but leaves the client ID and secret blank. Microsoft mode is the default and unconfigured access fails closed. Local UI work without Entra requires explicit `CM_AUTH_MODE=development`, which production rejects. IIS installation and real employee sign-in remain deployment checks.

Access requires the assigned `CMReporting.Access` role and tenant-member claim. Every data handler protects records, photos, address searches and exports. Sessions persist across restarts and expire after eight hours; logout revokes the current session. Expired sessions offer sign-in in a separate tab to preserve the current form. Assigned employees receive the existing reporting access; office/driver roles remain shared.

## Driver workflow

- Community, pickup address and street fields provide searchable suggestions. Drivers must choose a listed option. Editing a selection invalidates it; changing community clears the location. The server checks the community/location pair independently.
- One “Blocked by a vehicle” option combines car, truck, van and vehicle and requires one plate. “Blocked by multiple vehicles” requires two different plates in separate fields, with additional fields available. Street vehicle blockages also require two plates.
- “Other reason” requires a description.
- Take photo and the empty photo area request the native rear camera on phones and open an in-app camera preview on desktops. Gallery upload remains separate. HTTPS or localhost and camera permission are required. The actual native handoff still needs a check on the drivers' phones.
- At least one photo is required: up to 6 photos, 10 MB each and 30 MB total. Original JPG, PNG, WebP, GIF and HEIC/HEIF files remain downloadable. HEIC preview depends on browser support.
- The sidebar collapses on desktop and mobile. Desktop collapse retains accessible navigation icons. The expanded sidebar displays the Collective Waste Solutions and Circular Materials logos.

Reports receive an automatic Mountain-time timestamp and open status. Office staff can review photos, record resolutions and export daily or Exhibit 7 complaint CSVs. Both export forms require valid dates with the end date on or after the start date; the API also rejects invalid or reversed dates. Complaint fields are preserved. Exports link to photos rather than embedding image bytes.

## Email notifications

New blocked-call and complaint submissions can notify approved recipients through the company SMTP relay using mandatory STARTTLS on port 587. [Email setup](docs/email-notifications.md) covers credentials, recipient configuration, verification and retries. The initial recipients are `rtandon@collectivewaste.ca` and `jmarshall@collectivewaste.ca`. Enable `REPORT_EMAIL_ENABLED` only after installing the real SMTP password in the private environment. The example leaves that password blank; no live email has been sent or verified.

Notifications are committed with each report in a durable SQLite outbox, so SMTP outages do not lose submissions. The managed production start script runs the delivery worker and retries failures. Status edits do not send another submission email. Daily scheduled CSV delivery remains separate and is not enabled.

Failed submissions retain the draft and photos while the page stays open; this is not an offline queue. Only the driver-name preference is stored in the browser.

## Approved address catalogue

The import reconciles the latest reviewed local snapshots as of **24 September 2026**:

| Source | Service records | Coverage checked |
| --- | ---: | --- |
| C9 | 17,956 | Parkland 32-unit expansion; all 386 Brooks additions; Enchant and Hays Service Address sheets |
| Wood Buffalo | 19,458 | All 19,273 Customers.xlsx source rows accounted for, plus approved rural services |
| Combined | 37,414 | 39,676 community/address choices across 35 community options |

Identical choices within a community are collapsed; distinct units are retained. C9 matches the authoritative final workbook table rows, excluding leftover review cells outside the tables and the original Magrath `123 123` template row. Reviewed corrections and source hashes are recorded in the audit. No source workbooks or geocodes are changed.

Blairmore, Coleman, Frank and Hillcrest use their original workbook community names and matching addresses. The existing Crowsnest Pass group remains available, so 2,409 address choices are also offered under the individual towns. Routing subareas do not override workbook community names. The importer checks every source community against the generated list, including Enchant/Hays service-address additions and Wood Buffalo rural localities; the only spelling normalization is Beaver Mine to Beaver Mines.

Generated private files `data/service-locations.json` and `data/service-locations-audit.json` are present locally and ignored by Git. Transfer them separately when installing the application. Reproduce the snapshot using Python's standard library:

```powershell
python scripts/build-service-catalogue.py --source-root 'C:\Projects\ODA Data Generation'
```

The importer checks counts, lineage, additions and final workbook coverage before replacing the catalogue. Future source updates must update the reviewed source references and reconciliation checks; it does not guess the latest source from modification times.

Development reads `data/service-locations.json`; production reads `CM_DATA_DIR\service-locations.json`. Override with `CM_LOCATION_CATALOGUE_PATH` if needed. Atomic replacements reload without a rebuild. Missing or invalid lists reject new blocked-call submissions. Mailing addresses and test fixtures never seed the catalogue.

The protected `/api/locations` endpoint accepts `kind=community|address|street`, `q`, and `community` for address/street searches. It returns at most 25 matches and indicates whether more exist. The full catalogue is not bundled into browser JavaScript.

## Storage

SQLite stores reports, reasons, plates, filenames, media types, sizes and relative photo paths in `reports.sqlite`. Original image bytes are ordinary files under `photos\reports\<report-id>\<photo-id>.<extension>` in the private data folder. Protected record/photo endpoints serve downloads; files are never placed in `public`.

The SQLite adapter enables WAL, foreign keys and transactional writes. Photos are flushed before the report transaction commits. Failed uploads remove their attempted files; unchanged retries reuse the submission ID. A process crash before commit can leave an unreferenced file. Backups copy only database-referenced photos and never automatically delete live originals.

Production requires a persistent local-disk directory outside the app, an HTTPS origin and an IIS reverse proxy. The listener binds to `127.0.0.1`. Development defaults to `.local-data`. D1/R2 are no longer used by the runtime. Legacy Sites/Vite configuration remains historical scaffolding, not a supported launch path. **Existing hosted records and photos have not been migrated.**

The backup command snapshots SQLite, copies its referenced originals and catalogue, and verifies integrity, sizes and SHA-256 hashes. Server setup and restore commands are in the linked guide.

## Commands and verification

Use Node **24.15 or later**, from `C:\Projects\CM-reporting\app`:

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Start development manually. Production uses `npm.cmd start` after the server setup. Tests and builds do not start a server.

Tests cover selection-only locations, plate/reason requirements, camera interactions, SQLite restart persistence, original downloads, upload cleanup, retries, transaction rollback, complaints/exports, backup reopening, private paths and production access checks. They use temporary storage and fixture catalogues. Camera APIs are mocked; physical-device and server-gateway validation remain deployment checks.

References: [SQLite deployment guidance](https://www.sqlite.org/whentouse.html), [SQLite WAL](https://www.sqlite.org/wal.html), [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [native camera capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture).
