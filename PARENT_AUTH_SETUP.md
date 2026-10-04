# Parent authorization setup

Parent controls fail closed unless the loopback service and macOS guardian share a secret and the guardian has a current authenticated heartbeat. The browser never asks for, receives, or stores a macOS password.

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

This milestone proves the authorization protocol and native macOS prompt, but it does not install a privileged, code-signed guardian. Before calling the boundary production-ready, move the shared secret and configuration out of the child account, install a reviewed signed helper/agent from an administrator account, validate file ownership and permissions, and run the bypass and crash-recovery tests on the second Mac. Do not copy the example secret or a real secret into source control.

Apple notes that Authorization Services is intended for non-sandboxed macOS software that restricts its own features and that the Security Agent handles authentication. The guardian therefore must remain outside an App Sandbox.
