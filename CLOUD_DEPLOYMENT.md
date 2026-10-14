# Permanent Chromebook deployment

## Public entry page

`https://saoirsequest.meghangames.com` is served by the Cloudflare Worker
`meghangames-saoirsequest`, configured in `site/wrangler.jsonc`. It serves only
public app information, `/privacy`, and `/terms`. The Open Homework Quest link
leads to the existing Google IAP-protected Cloud Run URL; the public Worker has
no data bindings, credentials, or proxy to private APIs. Unknown paths return 404.

Deploy the entry page with `wrangler deploy --config site/wrangler.jsonc`.
The custom domain is an entry page, not a hostname migration of the private app.

## Private app

The production app runs as one request-billed Cloud Run instance protected by
direct Identity-Aware Proxy (IAP). Only explicitly granted Google accounts can
open the site. The service scales to zero when idle.

Durable data uses Firestore document `homework_state/saoirse`. The server keeps
the existing SQLite behavior in its ephemeral filesystem, checkpoints it, gzip
compresses it, and commits a new Firestore revision before completing each API
response. Cloud Run must remain limited to one instance to preserve the
single-writer guarantee. If overlapping instances conflict during replacement,
the losing request returns an error rather than overwriting confirmed progress.
On the next authenticated request, that instance reloads the latest cloud snapshot;
the user can reconnect and retry the failed action. Requests already in flight
against the old snapshot cannot write to or confirm the replacement snapshot.
Recovery does not replay unconfirmed reward or timer operations automatically.

The Google Calendar OAuth client ID and client secret are Cloud Run environment
secrets. The refresh token is stored separately in Secret Manager and is never
included in the container image, Firestore document, logs, or source control.

Required production settings:

- `HOMEWORK_DEPLOYMENT_MODE=google-iap`
- `HOMEWORK_ACCESS_AUDIENCE=/projects/417461782805/locations/us-west1/services/saoirse-homework`
- `HOMEWORK_ACCESS_EMAILS=meghan.oreillygreen@gmail.com,saoirse.rafferty@gmail.com`
- `HOMEWORK_PARENT_EMAILS=meghan.oreillygreen@gmail.com`

- `GOOGLE_CLOUD_PROJECT=saoirse-homework`
- `HOMEWORK_PERSISTENCE=firestore`
- `HOMEWORK_FIRESTORE_DOCUMENT=homework_state/saoirse`
- `HOMEWORK_DATA_DIR=/tmp/saoirse-homework`
- `HOMEWORK_CALENDAR_TOKEN_SECRET=saoirse-calendar-refresh-token`
- `HOMEWORK_PUBLIC_ORIGIN=https://<cloud-run-hostname>`
- `HOMEWORK_CALENDAR_ACCOUNT_EMAIL=<authorized account>`
- `HOMEWORK_CALENDAR_ID=primary`
- `HOMEWORK_TIME_ZONE=America/Los_Angeles`
- `HOMEWORK_SECURITY_MODE=preview`

Deployment invariants:

- IAP is enabled directly on the Cloud Run service.
- Unauthenticated Cloud Run invocation is disabled.
- IAP access is granted only to the intended family Google accounts.
- Minimum instances is zero; maximum instances is one.
- Request-based billing is used.
- The runtime service account has only Firestore user, Secret Manager accessor,
  and Secret Manager version-adder permissions.
- Calendar uses only `calendar.events.readonly` plus basic account identity.

Cloud Parent controls use the cryptographically verified Google IAP identity on
every request. Only the configured parent account receives the parent role.
Use separate Chrome profiles for parent and child; the signed-in parent profile
has parent access without a macOS guardian.

All hosted homework and drill timers count in the background in Google IAP mode,
including timers saved before this release. Keep the homework tab open; switching
tabs, windows, or app screens does not pause them. Delayed heartbeats catch up to
the current phase limit. Pause explicitly for breaks or device sleep: elapsed
time can count while the browser is suspended. A server restart still pauses
timers without charging downtime. Du Chinese pauses between its reading and
flashcard phases so the learner can switch activities. Managed local installs
retain their verification rules. No database schema changes are required.

Temporary owner-approved **Skip timer** completes an activity and awards its
normal credit once, recording `temporary-skip` rather than verified time.
Skipping a reward consumes its remaining time. Remove this bypass when the
owner requests normal timer enforcement again.

Calendar OAuth publishing was confirmed **In production** in the Google Cloud
console on October 8, 2026, after owner approval. This did not change homework
IAP access or Calendar scopes. Fresh authorization and uploading the replacement
token to Secret Manager remain pending. Tokens issued in Testing expire after
seven days; publishing alone does not establish that the deployed Calendar token
has been replaced.

## Reward decision and follow-up — October 8, 2026

Owner decision: use honor-system YouTube rewards for now. This release
uses self-timed rewards in Google IAP mode, without requiring the local Chrome
extension. Use now starts the timer; Open YouTube launches another tab. Keep the
homework tab open and pause manually for breaks/ads. The app shows an end-of-time
reminder but does not monitor playback or block YouTube. Unused time is retained
when ending a session. Pause before closing the tab or putting the device to sleep;
background gaps can count toward the current timer. Restart recovery does not
spend downtime. Managed local installs
keep their existing verified-playback behavior.

**Deferred until the live app is complete:** implement computer/website blocking
and enforced reward limits. First agree on Chromebook management/extension
requirements and parent recovery controls; assess other tabs, sleep, offline use,
and bypasses on a real Chromebook. Do not treat this note as authorization to
install device management or change account/security settings now.

Release readiness: cloud saves now retry after a temporary Firestore failure,
while preserving revision-conflict protection. Daily self-checks require an
online confirmation: a failed request leaves the previous checkmark unchanged,
and Retry reloads confirmed server progress rather than overwriting it with a
stale browser snapshot. The status area distinguishes saving, saved, and offline.
Browser-backup failures are reported without breaking online saving. No database
schema changes are included, and no production credits or completion records
were changed during testing.

Validation: 177 tests passed, TypeScript/production build passed, and an isolated
browser preview verified the reward instructions, YouTube link, pause, reload,
resume, credit deduction, and end-of-time reminder with a synthetic credit.
Save-recovery browser checks covered a failure before saving, rejected offline
checkmarks, and recovery after a successful save lost its confirmation. Progress
was retained after reload. Calendar reconnection remains a separate follow-up.
