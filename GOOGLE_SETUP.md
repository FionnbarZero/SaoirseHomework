# Live Google delivery setup

Live delivery is deliberately disabled by default. The local proof remains available while the service is in `safe-test` mode.

## What live mode does

After Friday at 4:00 p.m. in the configured school time zone, the local service:

1. Selects writing marked `complete` and snapshots it into one restart-safe weekly queue record.
2. Creates `My Drive/Fionnbar Homework/<School Year>/Writing` when needed.
3. Creates `Fionnbar Writing — Week of <Monday date>` with the original, corrected copy, and practice summary.
4. Exports the Google Doc as PDF and verifies the `%PDF-` signature before continuing.
5. Shares the Doc with the configured school address as a viewer.
6. Sends a separate Gmail message containing the PDF and, when sharing succeeded, the Doc link.

If sharing fails, the PDF is still emailed and the missing-link result is recorded. Other transient failures remain in the queue with an exponential retry time. The unique weekly record prevents an accidental second send for the same week.

## Google Cloud and Family Link

These steps must be completed by the parent who manages Fionnbar's account:

1. Create or choose a parent-owned Google Cloud project.
2. Enable the Google Drive API, Google Docs API, and Gmail API.
3. Configure the OAuth consent screen. Add the authorized account as a test user while the app remains in testing.
4. Create an OAuth 2.0 client with application type **Desktop app**.
5. In Family Link, allow Fionnbar's account to authorize this third-party app when prompted.

The app requests only identity/email, `drive.file`, and `gmail.send`. `drive.file` limits Drive access to files the app creates or that the user explicitly opens with it. A broader Docs scope is not requested because the Docs batch-update endpoint accepts `drive.file` for app-created documents.

Official references:

- [OAuth for desktop apps and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Docs batchUpdate authorization scopes](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate)
- [Export a Google Workspace file as PDF](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Send Gmail messages](https://developers.google.com/workspace/gmail/api/guides/sending)

## Local configuration

Copy the example without committing the result:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
HOMEWORK_GOOGLE_MODE=live
HOMEWORK_GOOGLE_CLIENT_ID=your-desktop-client-id.apps.googleusercontent.com
HOMEWORK_GOOGLE_CLIENT_SECRET=your-desktop-client-secret-if-provided
HOMEWORK_TIME_ZONE=America/Los_Angeles
```

`.env` and downloaded client-secret JSON files are ignored by Git. Never put a Google password, OAuth refresh token, or client configuration in source control.

Build and start the configured service:

```bash
npm run build
node --env-file=.env server/index.mjs
```

Open `http://127.0.0.1:4179`, go to the Parent screen, save the school recipient, then select **Authorize Google**. Google returns to the loopback callback on `127.0.0.1`; the app validates PKCE and state before storing only the refresh token in macOS Keychain under `com.fionnbar.homework.google`.

Use **Revoke Google access** to call Google's revoke endpoint and delete the Keychain token. Delivery history and local PDFs are retained for the audit trail.

## Readiness limitation

Live delivery includes only drafts whose review status is `complete`. The current writing flow ends at `spelling-pending`, so no production writing will leave the Mac until the spelling-practice module is implemented and explicitly advances a draft to `complete`. This is intentional fail-closed behavior.
