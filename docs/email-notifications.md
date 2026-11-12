# Daily blocked-call emails

Blocked calls are sent as one daily report containing only that calendar day's blocked calls and their photos. The schedule is **5:00 PM America/Edmonton**, including daylight-saving changes. Automatic sending is **off** until explicitly enabled. Complaint notifications retain their existing individual submission emails when sending is enabled.

## Configure CWS WEB01

Install these settings in the private `.env.production.local` on **CWS WEB01**. The relay is authorized for that web server; a local-PC connection is not a valid delivery test.

```dotenv
REPORT_EMAIL_ENABLED=false
BLOCKED_CALL_EMAIL_TIME=17:00
REPORT_EMAIL_TO=rtandon@collectivewaste.ca
REPORT_EMAIL_TEST_TO=rtandon@collectivewaste.ca
SMTP_HOST=Smtp1.shivtek.ca
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=false
SMTP_IGNORE_TLS=true
SMTP_AUTH_MODE=none
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=notifications@collectivewaste.ca
EMAIL_TEST_FROM_OPTIONS=notifications@collectivewaste.ca,no-reply@collectivewaste.ca
```

`SMTP_AUTH_MODE=none` omits login and relies on IT's approval of the application server's source IP. IT must also permit both From addresses. Leave the username and password blank. Existing configurations without `SMTP_AUTH_MODE` continue to use login.

SmartLayer confirmed that TLS is intentionally disabled and not required for `smtp1`. This configuration explicitly disables both implicit TLS and STARTTLS, including automatic upgrades. Report contents and photos are unencrypted on the connection from CWS WEB01 to this relay. This is the supplied relay's approved configuration; it does not establish the encryption used on later delivery hops.

The app permits `SMTP_IGNORE_TLS=true` only with `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=false`, `SMTP_AUTH_MODE=none`, and port 25. It never transmits login credentials in this mode, including stale credentials left in another environment source. Other SMTP services retain the existing TLS defaults: set `SMTP_IGNORE_TLS=false` and use required STARTTLS or implicit TLS. Certificate verification remains enabled in TLS modes.

Install dependencies with `npm.cmd ci`, build with `npm.cmd run build`, and restart the CM Reporting service after applying code or environment changes. Update NSSM environment values too if it supplies these variables directly. The service entry point remains `scripts/start-server.mjs`.

## Preview and test

1. Sign in to the office dashboard on CWS WEB01 and open **Exports**.
2. Under **Today's blocked-call email**, check the date, report/photo counts, and default recipient. Leave **Send to** blank to use `REPORT_EMAIL_TEST_TO` from the server environment (currently `rtandon@collectivewaste.ca`). To test another recipient, enter their email address; separate multiple addresses with commas or semicolons. Entered recipients replace the defaults for that test only. Clearing the field restores the environment default.
3. Select **Preview today's PDF** or **Preview today's Excel** to inspect the one-day report and all its photos. Preview downloads do not send email.
4. Select either `notifications@collectivewaste.ca` or `no-reply@collectivewaste.ca` in **Test sender**, then select **Send test email**. The subject starts with `[CM Reporting TEST]`.
5. Check your inbox and attachment. Choose the other sender to test it as well. Relay acceptance alone does not prove inbox delivery.

The test works while automatic sending is off. It does not create records, enable the schedule, or change the environment or automatic recipient list (`REPORT_EMAIL_TO`). Sender options remain allowlisted in server configuration. Signed-in office users can override test recipients; the server validates plain email addresses, removes duplicates, and rejects malformed input before preparing a report or sending. Authentication and same-origin protection apply. Driver-only sessions cannot access these controls. A one-minute database-backed limit applies per date and sender, even when recipients change, so both sender options can be tested immediately without concurrent duplicate sends.

The test and preview select today's records at request time. The automatic report selects today's records at the 5:00 PM run. Later submissions are not appended to an already queued report. If the service is down at 5:00 PM, it queues the current day's report when it resumes later that day; it does not create missed reports for previous dates. A day with no blocked calls produces a dated zero-report PDF.

## Keep automatic delivery off

Leave `REPORT_EMAIL_ENABLED=false` as requested. When activation is explicitly desired, set it to `true` and restart the managed service. Blocked calls will then be queued once per day at or after `BLOCKED_CALL_EMAIL_TIME`; complaints will send their existing individual notifications. No user-interface test enables this setting.

The managed worker checks every 15 seconds. `next start` and `npm.cmd run dev` alone do not launch the worker, but the manual test still works. Daily batches and their recipient lists are stored durably in SQLite. Existing unsent individual blocked-call notifications are marked superseded when the daily worker runs; they are retained for audit and not sent alongside the daily report.

## PDF, Excel and photos

The attached PDF uses a compact dated header, with each call's details on the left and photographs on the right. Short calls with one photo generally fit four per US Letter page; longer details and additional photos use more space. Each complete record is measured before placement and moves to the next page as one block if needed. Exceptionally long records use one taller page at the same readable text size, so no record, photo, caption or note is split or dropped. Report details use saved data at preparation time; the automatic batch fixes its record IDs and recipients when queued. A retry keeps the original batch date, so different dates are never mixed.

The Excel download contains a filterable **Summary** and **Details and photos** with embedded images. Click a reference in Summary to jump to that call's photos. Print areas, repeating headings and page breaks keep the printout compact. The PDF and Excel previews use the same daily selection and saved fields. Test and automatic emails currently attach the PDF; downloading Excel does not change the email format.

JPEG, PNG, WebP, GIF, and HEIC/HEIF uploads are converted to JPEG copies. Animated/multi-image files use their first image. Photos retain their aspect ratio and orientation. Copies use up to 1,600 pixels on the longest side; busy days start at an appropriate smaller size and can reduce as far as 384 pixels to fit the budget. Original evidence files are unchanged.

The shared PDF, Excel and total email-attachment allowance defaults to **20 MiB**, approximately 27.4 MiB after base64 encoding and line wrapping. No new environment setting is required. `REPORT_ATTACHMENT_MAX_MB` optionally sets an integer from 5 to 30 MiB; larger values are rejected. The maximum leaves room under smtp1's advertised 50,480,000-byte message limit, including MIME overhead. The receiving mailbox's own limit still applies. A 234-report/234-photo day now allocates about 83 KiB per image instead of the old 17 KiB. Size failures are reported separately from unreadable photos, and no records or images are silently dropped.

Missing or corrupt photos, or a day too large to fit after resizing, produce `EATTACHMENT`. No photos or reports are silently omitted. The automatic email stays pending for retry; the manual test reports the failure. Review the evidence and attachment size if this occurs. Individual record drawers also offer a PDF download with photos.

## Verification and retries

Run `npm.cmd run server:check` for configuration validation and `npm.cmd run email:check` on CWS WEB01 to check the SMTP connection using the configured authentication and encryption modes without sending mail. For smtp1 it should print `authentication: none; encryption: disabled (approved relay)`. The check cannot prove sender permission or inbox delivery.

`ETIMEDOUT` means the connection/greeting/response timed out, `ETLS` means TLS failed, and `EENVELOPE` means the relay rejected sender or recipient. Ask IT to inspect relay logs if a test fails.

For `EATTACHMENT` or a failed report preview, run `npm.cmd run report:check` from the application directory on CWS WEB01. It loads the production environment and opens `reports.sqlite` read-only. It checks today's Edmonton report selection, the PDF engine/font, every saved photo, and the complete PDF against the shared attachment allowance. It sends no email, does not change records/photos or the outbox, and does not enable automatic delivery. Output includes the attachment allowance and per-image budget, and identifies the failing stage and photo number. It shows at most 20 issue examples along with the total issue count; it still checks every selected photo. Diagnostic errors can include private file paths; the check does not print SMTP credentials or contact SMTP.

The CLI preserves the underlying error that the browser's generic response intentionally hides. If it passes as an administrator while the service preview fails, compare the CMReporting service account's file permissions, working directory and `CM_DATA_DIR` with that command's environment. After pulling this diagnostic, no rebuild or service restart is needed to run the command itself.

### Relay diagnostic observed on 2026-11-12

The CWS WEB01 diagnostic connected to `Smtp1.shivtek.ca:25`. Its EHLO response advertised `SIZE 50480000`, `AUTH LOGIN`, and `HELP`, with no `STARTTLS`. A separate STARTTLS attempt returned `503 Bad sequence of commands` before any TLS handshake or certificate check. An unencrypted connection-only probe completed without login; it did not send a message or establish permission to use either sender address.

SmartLayer's supplied email confirms the lack of TLS is intentional. The presence of `AUTH LOGIN` advertises an available login method; it does not establish whether this application's source IP must authenticate. `email:check` prints the effective host, port, login mode and encryption mode without exposing credentials, making old environment overrides visible. Process/service environment values take precedence over environment files, so clear earlier PowerShell overrides or update them before checking the production file.

Automatic delivery retries begin after 30 seconds and increase to one hour. Failures do not roll back saved reports. Worker leases expire after five minutes. SMTP-accepted recipients are marked separately, preventing another send to an already accepted recipient during a retry. A crash after SMTP acceptance but before the database update can still produce a duplicate.

Back up `reports.sqlite` and uploaded photos together. Review pending notifications with automatic delivery off before running a restored backup. Running `npm.cmd run email:worker -- --once` with sending enabled queues today's due report and sends pending messages; it is not a connection-only test.
