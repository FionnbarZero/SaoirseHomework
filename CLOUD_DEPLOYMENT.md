# Permanent Chromebook deployment

The production app runs as one request-billed Cloud Run instance protected by
direct Identity-Aware Proxy (IAP). Only explicitly granted Google accounts can
open the site. The service scales to zero when idle.

Durable data uses Firestore document `homework_state/saoirse`. The server keeps
the existing SQLite behavior in its ephemeral filesystem, checkpoints it, gzip
compresses it, and commits a new Firestore revision before completing each API
response. Cloud Run must remain limited to one instance to preserve the
single-writer guarantee.

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

Du Chinese uses self-timed reading and flashcard phases in Google IAP mode.
Keep the homework tab open and pause for breaks. It does not verify activity on
the external site, and browser sleep or heartbeat throttling can pause credit.

Calendar production readiness also requires publishing the OAuth consent app
and reconnecting Calendar after publishing. Tokens issued in Testing expire
after seven days. Until publishing and reconnection are verified, calendar
authorization is temporary even though the website itself is deployed.
