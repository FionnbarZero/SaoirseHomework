# Guardian second-Mac deployment

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

## Next security gate

Before this package can carry Parent authorization or application enforcement, implement and review:

1. A signed parent application that registers its agent and daemon with `SMAppService`.
2. An XPC protocol between the user-session agent and privileged daemon.
3. Peer code-signature validation and narrow message schemas at that boundary.
4. Administrator authorization passed as an external authorization reference and revalidated immediately before sensitive work.
5. Signed release, upgrade, rollback, crash, logout, and child-account bypass tests on the second Mac.

The current direct shared-secret flow remains a local feasibility test only.
