# Guardian deployment

## Production enforcement boundary

Version 0.8.0 adds daily managed Level Chinese and Du Chinese activities, a nine-session music practice bank, and a reviewable parent app with the structure required by Apple's Service Management framework and hardened local-service and user-session boundaries:

- `Fionnbar Homework Parent.app` registers one embedded per-user LaunchAgent and two privileged LaunchDaemons through `SMAppService`.
- The agent and parent connect only to the daemon's named XPC service.
- The daemon automatically rejects peers unless their code signature has the same Apple team and one of the two exact allowed identifiers.
- The protocol exposes only status, application evaluation, typed child-session transitions, Homework-mode changes, and complete policy replacement. It has no generic command, path, shell, or arbitrary payload operation.
- Mode and policy changes require a 32-byte Authorization Services external reference. The daemon revalidates `system.privilege.admin` without allowing UI immediately before changing state.
- Requests expire after 30 seconds, reject clock movement into the future, require a printable audit reason, and persist a bounded replay and audit log in a root-owned state file.
- The daemon owns the blocked-app policy and returns one of four decisions: `inactive`, `allowed`, `blocked`, or `unavailable`.
- The signed session agent asks the daemon about the still-frontmost application every five seconds and sends an ordinary termination request only for a daemon-issued `blocked` decision. It never force-terminates an app.
- Child entry creates a persistent service-session UUID. The signed agent may use it only to begin or maintain a restrictive daemon session.
- Verified Free mode closes that session only when the agent presents both the matching server proof and the daemon's random completion capability. Completed and parent-overridden service-session IDs cannot restart.
- A second `SMAppService` LaunchDaemon runs the packaged homework service from sealed app resources with its own bundled Node runtime.
- The launcher creates `/Library/Application Support/FionnbarHomework/Data` as root-only `0700`; SQLite is forced to `0600` and child processes cannot replace its ledger.
- The service and guardian daemon share a random 32-byte key generated under the root-only privileged directory. The key is never embedded or sent to the agent.
- Each lifecycle response includes a 15-second opaque HMAC-SHA256 assertion. The daemon validates the tag, timestamp, session identity, mode, and exact completion totals before changing privileged state.
- The daemon issues the signed login agent scoped 15-second service grants. The root service uses those grants for agent heartbeat and a bounded credential-operation queue; there is no production shared secret in the child session.
- Native Parent approval runs in the signed agent, is independently revalidated by the privileged daemon, and reaches the root service only as an HMAC assertion bound to the exact challenge, purpose, and decision.
- Google PKCE, token exchange, refresh, revocation, and refresh-token Keychain access run in the signed login agent. The root service receives only short-lived access tokens and never reads the child's login Keychain.
- If the service is unavailable or a localhost impersonator returns unsigned or altered data, lifecycle synchronization is deferred while the agent continues enforcing the daemon's last persisted state.
- Unsigned and ad-hoc builds refuse to run, and the release report stays non-installable until every component has one hardened team signature and the app has a stapled notarization ticket.

The embedded release metadata records `enforcementIncluded: true` and `rootOwnedServiceIncluded: true` but keeps `productionReady: false`. Signing/notarization, signed upgrade/rollback, and the second-Mac acceptance matrix remain release gates.

### Build a production review app

From the repository root:

```bash
npm run build:guardian-app
```

This creates the app, release report, archive, and archive checksum under `guardian/build/`. With no Apple signing identity, the output is for code and bundle review only and reports `Install ready: no`.

The builder copies the current Node executable into the sealed app, along with only the server's runtime resources and PDF dependencies. Build on the same macOS architecture as the target Mac, or provide a reviewed compatible runtime with `--node-binary`.

After a Developer ID Application identity and notarization profile exist, build without creating the pre-notarization archive:

```bash
node guardian/deployment/build-production-app.mjs \
  --identity "Developer ID Application: Parent Name (TEAMID)" \
  --no-archive
```

Submit a ZIP made with `ditto` to Apple's notary service, wait for acceptance, and staple the ticket to the app. Then create the final verified archive without rebuilding or disturbing the ticket:

```bash
node guardian/deployment/build-production-app.mjs \
  --verify-only \
  --output "guardian/build/Fionnbar Homework Parent.app"
```

The final report must show `Signing ready: yes`, `Notarization ready: yes`, and `Install ready: yes`. It will still show `Production ready: no` until the remaining acceptance work is implemented. A signed daemon embedded in an app must be notarized; signing alone is not a release gate.

The parent executable supports these narrow operations once the app is signed and located in `/Applications`:

```bash
"/Applications/Fionnbar Homework Parent.app/Contents/MacOS/fionnbar-homework-parent" --register
"/Applications/Fionnbar Homework Parent.app/Contents/MacOS/fionnbar-homework-parent" --status
"/Applications/Fionnbar Homework Parent.app/Contents/MacOS/fionnbar-homework-parent" \
  --replace-policy --reason "Reviewed blocked apps" \
  --blocked-bundle-id com.apple.Safari \
  --blocked-bundle-id com.apple.Terminal \
  --blocked-bundle-id com.roblox.Roblox
"/Applications/Fionnbar Homework Parent.app/Contents/MacOS/fionnbar-homework-parent" \
  --disable-homework --reason "Parent-authorized maintenance"
```

Registration may still require explicit daemon approval in **System Settings → General → Login Items**. The registration command now installs the homework service daemon first, then the guardian daemon and user agent. Do not register this build on the daily-use child account until the remaining integration and second-Mac tests below are complete.

## Legacy dry-run review bundle

This directory builds a reviewable macOS deployment bundle for the guardian. The bundle is deliberately limited to a signed **dry-run agent**. It cannot enable enforcement and it cannot deploy the feasibility prototype's shared secret into the child account.

That limitation is a security control. A process running in the child's login session cannot safely read a root-only secret, while making the secret readable to that process would also make it available to the child. Apple separates user-session agents from system daemons for this reason: an agent can observe the logged-in session, while privileged state belongs in a daemon/helper. The production design therefore requires a signed app with an `SMAppService` agent and daemon plus authenticated XPC before Parent authorization and enforcement can be installed.

## Build a review bundle

From the repository root:

```bash
npm run build:guardian-package
```

Without a signing identity, this produces an unsigned review archive and archive checksum under `guardian/build/` and reports `Install ready: no`. It is useful for inspecting payloads and running checksum/configuration validation, but the administrator tool refuses to install it.

To create an installable dry-run bundle after a Developer ID or appropriate Apple team identity is available:

```bash
node guardian/deployment/build-bundle.mjs \
  --identity "Developer ID Application: Parent Name (TEAMID)"
```

The builder signs only the copied bundle binary with the hardened runtime. It does not modify the Swift build product in `.build/`.

## Review and install

Extract the archive on the second Mac, then inspect it without changing the system:

```bash
./guardian-admin bundle-report
./guardian-admin plan --child-user fionnbar
```

Installation requires all of the following:

- macOS 13 or later;
- an existing standard child account;
- valid bundle checksums;
- a non-ad-hoc Apple team signature with hardened runtime;
- `allowEnforcement: false`;
- no shared secret in the child-readable configuration;
- a currently logged-in child account, so its GUI launchd domain exists.

Only after the plan says `PLAN_READY=yes`:

```bash
sudo ./guardian-admin install --child-user fionnbar
sudo ./guardian-admin health --child-user fionnbar
```

The install places root-owned files in `/Library/Application Support/FionnbarHomework`, installs a root-owned LaunchAgent property list in `/Library/LaunchAgents`, creates a private child log directory, and starts the dry-run agent. The binary and configuration cannot be modified by the standard child account. Missing or stopped guardian heartbeats remain visible to the local service. If any installation step fails, the tool automatically restores the exact preinstall snapshot.

## Recoverable removal and rollback

Uninstall preserves logs and copies installed material to a root-only timestamped backup before removing the exact installed files:

```bash
sudo ./guardian-admin uninstall --child-user fionnbar
```

The command prints a backup ID. Restore that exact backup with:

```bash
sudo ./guardian-admin rollback \
  --child-user fionnbar \
  --backup-id 20261003T190000Z-uninstall
```

No command deletes homework data, logs, or backups. There is intentionally no force flag and no installer path that adds `--enforce`.

## Remaining release gate

Before this package can enforce Homework mode on the daily-use child account:

1. Obtain the Developer ID Application identity, notarize and staple the app, and confirm every executable component shares the expected team.
2. Add signed upgrade and recoverable rollback handling for the app bundle and its root-owned database/key material.
3. Run release, upgrade, rollback, crash, logout, sleep, restart, HMAC and broker replay/tampering, service-impersonation, OAuth/Keychain, and child-account bypass tests on the second Mac.

The current direct shared-secret flow remains a local feasibility test only.
