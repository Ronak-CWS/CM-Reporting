# CM Reporting

CM Reporting is a private operations portal for Circular Materials Catchment 9. It implements the two workflows described in sections 3 and 4 of the supplied requirements:

- Daily reporting currently accepts **blocked calls only**, for individual pickup locations or a street/street block.
- Inquiry and complaint reporting using the Exhibit 7 fields, including customer details, contact medium, logging employee, resolution, and resolution date/time.

## What is included

- Dashboard with current operational counts and recent activity.
- A mobile-friendly driver wizard: blockage type → location → reason → photos → review.
- The original BlockedCallApp pickup reasons, plus separate street-block reasons and an "Other reason" option.
- Camera capture or gallery upload, with at least one photo required. Up to 6 photos, 10 MB each and 30 MB per report (JPG, PNG, WebP, GIF, HEIC/HEIF). HEIC preview depends on browser support; the original file remains downloadable.
- Automatic Mountain-time timestamp and open status; office staff manage resolution separately.
- A separate complaint-entry form retaining the Exhibit 7 fields.
- Searchable registers with priority and resolution status.
- Record detail and resolution-update workflow.
- Durable Cloudflare D1 records and R2 photo storage. Photos can be opened/downloaded from record details and are protected by the site's existing private access.
- Daily operational CSV export including blockage scope, street section, reason, photo count and photo paths (the export does not embed image bytes).
- Exhibit 7 complaint CSV export.
- Responsive desktop and mobile layouts.

Automatic email delivery is intentionally not enabled until the production email service and dedicated CM recipient list are supplied.

## Submission safety

The server validates reasons and actual image signatures, bounds upload sizes, and saves report metadata only after all photos are stored. A retry of an unchanged report reuses its submission ID to avoid duplicates. Failed submissions keep the in-memory draft and photos while the page stays open; this is not an offline queue. Only the driver-name preference is remembered locally. Closing/reloading an unsubmitted report loses that draft after a warning.

Schema changes are additive: `report_blockages` and `report_photos` extend existing records without rewriting them. Older reports remain readable with no attached photos. Generated migrations are included in deployment artifacts.

## Local commands

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The local development URL is printed by the development command.

Tests cover reason/field validation, the stepped driver interaction, required photos and retry behavior, plus isolated D1/R2 integration for saving, reloading, downloads, upload-failure cleanup, and complaint/export compatibility. They do not write test records to the live site.
