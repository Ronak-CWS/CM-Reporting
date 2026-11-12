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
SMTP_REQUIRE_TLS=true
SMTP_AUTH_MODE=none
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=notifications@collectivewaste.ca
EMAIL_TEST_FROM_OPTIONS=notifications@collectivewaste.ca,no-reply@collectivewaste.ca
```

`SMTP_AUTH_MODE=none` omits login and relies on IT's approval of the application server's source IP. IT must also permit both From addresses. If credentials are required, select `SMTP_AUTH_MODE=login` and install them privately. Existing configurations without `SMTP_AUTH_MODE` continue to use login.

STARTTLS and certificate verification remain required. Confirm that the relay supports STARTTLS on port 25 and permits outbound access from CWS WEB01. Do not disable certificate verification to work around a connection failure.

Install dependencies with `npm.cmd ci`, build with `npm.cmd run build`, and restart the CM Reporting service after applying code or environment changes. Update NSSM environment values too if it supplies these variables directly. The service entry point remains `scripts/start-server.mjs`.

## Preview and test

1. Sign in to the office dashboard on CWS WEB01 and open **Exports**.
2. Under **Today's blocked-call email**, check the date, report/photo counts, and recipient. Test messages go **only to rtandon@collectivewaste.ca**.
3. Select **Preview today's PDF** or **Preview today's Excel** to inspect the one-day report and all its photos. Preview downloads do not send email.
4. Select either `notifications@collectivewaste.ca` or `no-reply@collectivewaste.ca` in **Test sender**, then select **Send test email**. The subject starts with `[CM Reporting TEST]`.
5. Check your inbox and attachment. Choose the other sender to test it as well. Relay acceptance alone does not prove inbox delivery.

The test works while automatic sending is off. It does not create records, enable the schedule, or use the automatic recipient list. Both sender options and test recipients are allowlisted in server configuration; browser input cannot add addresses. Authentication and same-origin protection apply. Driver-only sessions cannot access these controls. A one-minute database-backed limit applies per date and sender, so both sender options can be tested immediately without concurrent duplicate sends.

The test and preview select today's records at request time. The automatic report selects today's records at the 5:00 PM run. Later submissions are not appended to an already queued report. If the service is down at 5:00 PM, it queues the current day's report when it resumes later that day; it does not create missed reports for previous dates. A day with no blocked calls produces a dated zero-report PDF.

## Keep automatic delivery off

Leave `REPORT_EMAIL_ENABLED=false` as requested. When activation is explicitly desired, set it to `true` and restart the managed service. Blocked calls will then be queued once per day at or after `BLOCKED_CALL_EMAIL_TIME`; complaints will send their existing individual notifications. No user-interface test enables this setting.

The managed worker checks every 15 seconds. `next start` and `npm.cmd run dev` alone do not launch the worker, but the manual test still works. Daily batches and their recipient lists are stored durably in SQLite. Existing unsent individual blocked-call notifications are marked superseded when the daily worker runs; they are retained for audit and not sent alongside the daily report.

## PDF, Excel and photos

The attached PDF uses a compact dated header and groups each call's details with its photos. Ordinary calls with two photos generally fit two per page. Longer notes and additional photos continue onto further pages without dropping content. Report details use saved data at preparation time; the automatic batch fixes its record IDs and recipients when queued. A retry keeps the original batch date, so different dates are never mixed.

The Excel download contains a filterable **Summary** and **Details and photos** with embedded images. Click a reference in Summary to jump to that call's photos. Print areas, repeating headings and page breaks keep the printout compact. The PDF and Excel previews use the same daily selection and saved fields. Test and automatic emails currently attach the PDF; downloading Excel does not change the email format.

JPEG, PNG, WebP, GIF, and HEIC/HEIF uploads are converted to JPEG copies. Animated/multi-image files use their first image. Photos retain their aspect ratio and orientation. Copies start at up to 1,600 pixels on the longest side and are reduced further as necessary to fit the daily attachment budget. Each PDF or Excel report is limited to 5 MiB, approximately 7 MiB after email encoding. Original evidence files are unchanged.

Missing or corrupt photos, or a day too large to fit after resizing, produce `EATTACHMENT`. No photos or reports are silently omitted. The automatic email stays pending for retry; the manual test reports the failure. Review the evidence and attachment size if this occurs. Individual record drawers also offer a PDF download with photos.

## Verification and retries

Run `npm.cmd run server:check` for configuration validation and `npm.cmd run email:check` on CWS WEB01 to check the SMTP connection and TLS without sending mail. The check cannot prove sender permission or inbox delivery.

`ETIMEDOUT` means the connection/greeting/response timed out, `ETLS` means TLS failed, and `EENVELOPE` means the relay rejected sender or recipient. Ask IT to inspect relay logs if a test fails.

Automatic delivery retries begin after 30 seconds and increase to one hour. Failures do not roll back saved reports. Worker leases expire after five minutes. SMTP-accepted recipients are marked separately, preventing another send to an already accepted recipient during a retry. A crash after SMTP acceptance but before the database update can still produce a duplicate.

Back up `reports.sqlite` and uploaded photos together. Review pending notifications with automatic delivery off before running a restored backup. Running `npm.cmd run email:worker -- --once` with sending enabled queues today's due report and sends pending messages; it is not a connection-only test.
