# Parent authorization setup

The current local-feasibility Parent controls fail closed unless the loopback service and macOS guardian share a secret and the guardian has a current authenticated heartbeat. The browser never asks for, receives, or stores a macOS password.

## Local feasibility setup

1. Generate a unique secret outside the repository:

   ```bash
   openssl rand -base64 32
   ```

2. Copy `guardian/guardian.example.json` to an untracked, parent-controlled location. Put the generated value in `sharedSecret`. Keep `allowEnforcement` false for the authorization test.
3. Start the service with the same value. For a one-off development run:

   ```bash
   HOMEWORK_GUARDIAN_SHARED_SECRET='generated value' npm run dev
   ```

   For the built service, place the value in the ignored `.env` file and use:

   ```bash
   npm run build
   node --env-file=.env server/index.mjs
   ```

4. In another Terminal window, start the guardian with the copied configuration:

   ```bash
   cd guardian
   swift run homework-guardian --config /absolute/path/to/guardian.json
   ```

5. Open Parent controls. The guardian requests the `system.privilege.admin` right from macOS Authorization Services. macOS owns the credential window; the guardian reports only approval or denial to the service.

Successful approval creates an HttpOnly, SameSite session cookie that expires after ten minutes. The cookie is held only by the running service and browser. Google authorization, Google revocation or sending, delivery retries, and preview reset request a fresh macOS authorization and have a two-minute sensitive-action window. Locking Parent controls revokes the session immediately. Restarting the service also invalidates every session and pending request.

## Recovery mode

`HOMEWORK_SECURITY_MODE=preview` is the development default and does not lock the child interface. After the guardian and managed Chrome installation have been reviewed on the second Mac, set:

```dotenv
HOMEWORK_SECURITY_MODE=enforcing
```

During Homework mode, enforcing mode shows a locked recovery screen if the guardian, managed Chrome, or local service is unavailable. It awards no offline completion or reward credit. Parent repair controls can open only while both the service and authenticated guardian are reachable.

## Production boundary

The production foundation now includes a parent app, an `SMAppService` enforcement agent and policy daemon, exact-peer code-signature requirements, narrow XPC messages, and daemon-side revalidation of external administrator authorization. It persists only the resulting mode, blocked-app policy, and audit record; it does not persist or log the external authorization reference.

The signed agent now connects child entry and verified Free-mode completion to daemon-owned sessions. Entry can only tighten restrictions. Completion requires a matching server proof and the daemon's random, persisted capability; parent-only exits still require fresh administrator authorization. The production bundle also includes a root-owned service launcher, sealed service resources, a root-only SQLite directory, and a first-launch 32-byte key shared only by the two root daemons. Every active lifecycle response carries a 15-second HMAC assertion, and the privileged daemon rejects missing, expired, changed, or forged assertions.

The same signed agent now owns the production Parent and Google user-session boundary. It requests the native administrator right, sends the external reference to the privileged daemon for independent validation, and returns only a short-lived HMAC decision assertion to the root service. Google PKCE, token exchange, refresh, revocation, and refresh-token Keychain access also run in the signed login agent. The root service receives short-lived access tokens through a bounded operation queue, never the refresh token. The daemon issues 15-second service grants, so the child cannot call those broker endpoints with a reusable secret.

Production-app metadata still records `productionReady: false`. Every component must still be signed and notarized, signed upgrade and rollback handling must preserve the root database and key, and the bypass/crash matrix must pass on the second Mac. No lifecycle key, OAuth token, or real shared secret belongs in source control or the app bundle.

Apple notes that Authorization Services is intended for non-sandboxed macOS software that restricts its own features and that the Security Agent handles authentication. The guardian therefore must remain outside an App Sandbox.
