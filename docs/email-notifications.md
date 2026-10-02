# Report submission email notifications

New blocked-call reports and complaint reports can send a notification through the company's SMTP relay. Each approved recipient receives a separate plain-text message with the report reference, community, location, submitting employee, category, priority, description, photo count, and dashboard link. Photos and customer contact details are not attached. Recipients must sign in to view protected evidence. Edits and status updates do not generate submission notifications. Daily scheduled CSV emails are not enabled by this feature.

## Configure the Windows server

Add these settings to the private `.env.production.local` in the application directory. The supplied example password was described as fake, so it is not stored in the repository or used to contact SMTP. Install the real password privately and provide the approved recipient list before enabling delivery.

```dotenv
REPORT_EMAIL_ENABLED=true
REPORT_EMAIL_TO=rtandon@collectivewaste.ca,jmarshall@collectivewaste.ca
SMTP_HOST=outbound-us1.ppe-hosted.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=no-reply@collectivewaste.ca
SMTP_PASS=<real password installed privately>
EMAIL_FROM=no-reply@collectivewaste.ca
```

The tracked `.env.example` includes the approved initial recipients listed above, leaves the password blank, and defaults notifications to disabled. No recipient is inferred from the sender, user accounts, or earlier emails. `SMTP_SECURE=false` with `SMTP_REQUIRE_TLS=true` on port 587 requires STARTTLS before authentication/delivery; certificate verification remains enabled. [Nodemailer SMTP settings](https://nodemailer.com/smtp).

Run from the application directory after configuring the real environment:

```powershell
npm.cmd run server:check
npm.cmd run email:check
npm.cmd run build
```

The server preflight validates the settings without opening an SMTP connection. `email:check` connects, negotiates TLS, and authenticates without sending mail. It does not prove that the relay permits the From address or that a message reaches an inbox. Allow outbound TCP 587 from the server to the relay and have IT confirm sender/relay permissions. Restart the CM Reporting service after changing its environment.

## Delivery and retries

The report and its notification rows commit in the same SQLite transaction. Invalid reports and failed photo uploads leave no email queued. Retrying the same blocked-call submission returns the original report without creating another notification. Separate recipients are deduplicated and captured at submission time; later recipient-list changes apply to new reports.

The managed `scripts/start-server.mjs` entry point starts the email worker alongside Next.js when notifications are enabled. It checks the queue every 15 seconds and sends at most 20 messages per pass. If either child exits unexpectedly, the entry point stops both and exits with a failure status so NSSM can restart the service. Configure NSSM to terminate the child process tree.

SMTP failures do not roll back saved reports. Retry delays start at 30 seconds and increase to at most one hour. Pending messages survive service restarts; worker leases prevent simultaneous processing and expire after five minutes if a worker crashes. SMTP-accepted messages are marked sent. As with other SMTP outboxes, a crash after SMTP acceptance but before the database update can cause a duplicate; stable Message-IDs help identify these cases but do not guarantee inbox deduplication.

The outbox lives in the private `reports.sqlite` and is included in reporting backups. Before enabling the worker on a restored backup, review pending notifications: some may have been delivered after that backup was created. Keep `REPORT_EMAIL_ENABLED=false` while reviewing a restore. Never clear reporting data to reset email delivery.

For an explicit manual retry pass, stop the managed worker first and run:

```powershell
npm.cmd run email:worker -- --once
```

This command sends due queued messages to the configured recipients; it is not a connectivity-only test. Running `next start` or `npm.cmd run dev` directly does not launch the worker. Local UI work should keep notifications disabled; use the managed entry point for production.

## Verification

Automated tests exercise SMTP settings and safe errors with a mocked transport, durable retries, concurrent claims, abandoned leases, saved-report integration, upload rollback, and duplicate submissions. They do not contact the company relay or send messages. After deployment, submit one authorized test report and confirm its reference appears in the intended inbox and its dashboard link requires Microsoft sign-in.
