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
