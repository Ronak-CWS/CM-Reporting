# CM Reporting

CM Reporting is a private operations portal for Circular Materials Catchment 9. It implements the two workflows described in sections 3 and 4 of the supplied requirements:

- Daily reporting for incidents, service problems, blocked calls, complaints, and corrective actions.
- Inquiry and complaint reporting using the Exhibit 7 fields, including customer details, contact medium, logging employee, resolution, and resolution date/time.

## What is included

- Dashboard with current operational counts and recent activity.
- Daily report and complaint entry forms.
- Searchable registers with priority and resolution status.
- Record detail and resolution-update workflow.
- Durable Cloudflare D1 storage.
- Daily operational CSV export.
- Exhibit 7 complaint CSV export.
- Responsive desktop and mobile layouts.

Automatic email delivery is intentionally not enabled until the production email service and dedicated CM recipient list are supplied.

## Local commands

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
```

The local development URL is printed by the development command.
