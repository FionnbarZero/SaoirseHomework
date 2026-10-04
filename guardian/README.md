# macOS Guardian

The guardian now contains two deliberately separate paths:

- `homework-guardian` is the original local feasibility executable. It uses the loopback service and an optional shared secret, and remains dry-run by default.
- `Fionnbar Homework Parent.app` is the production security-boundary foundation. It embeds an `SMAppService` user agent and privileged daemon that communicate over an authenticated XPC protocol. It does not yet contain application enforcement.

The production components refuse to run without a non-ad-hoc Apple team signature and their exact expected signing identifiers. The daemon accepts only the signed parent app and signed agent from that same team. Homework-mode changes require a fresh macOS administrator authorization reference, are replay-protected, and are written to a root-owned audit state file.

## Feasibility executable

This Swift command-line guardian is the first feasibility prototype for the child Mac. It reads the local homework service's requested mode, observes the frontmost application's bundle identifier, applies the service-provided blocked-app policy, and reports a heartbeat every five seconds.

It also handles Parent-control authorization challenges. For each challenge it creates a fresh macOS Authorization Services session, requests the administrator-only `system.privilege.admin` right, reports only approval or denial, and destroys the authorization rights immediately. The browser never handles administrator credentials.

The guardian is deliberately safe by default:

- Dry-run is the default and never closes an application.
- Enforcement requires both `allowEnforcement: true` in the parent-owned configuration and the `--enforce` command flag.
- `--simulate-homework` cannot be combined with enforcement.
- The service URL must be the loopback address `127.0.0.1`.
- The LaunchAgent file is a template only. Nothing installs or loads it automatically.
- Parent authorization remains unavailable until the guardian and service share a unique secret of at least 32 characters.

## Build and test

```bash
cd guardian
swift test
swift build -c release
```

Build an unsigned production-app review artifact from the repository root:

```bash
npm run build:guardian-app
```

The unsigned report must say `Install ready: no`. See [`deployment/README.md`](deployment/README.md) for signing, notarization, registration, and remaining release gates.

## Safe checks

```bash
swift run homework-guardian --check
swift run homework-guardian --simulate-homework --fixture-bundle-id com.apple.Terminal
swift run homework-guardian --once
```

The simulation should report `decision=blocked action=would-terminate` without contacting the service or affecting Terminal.

See `../PARENT_AUTH_SETUP.md` for the shared-secret and native authorization test. Never commit the filled guardian configuration.

## Installation boundary

Do not enable enforcement or manually load the template LaunchAgent on a daily-use account. The reviewed deployment tooling in [`deployment/`](deployment/) can build and validate a signed dry-run-only bundle, install root-owned files, run health checks, and perform recoverable uninstall or rollback. It intentionally refuses unsigned binaries, administrator child accounts, enforcement, and embedded shared secrets.

The `SMAppService` and authenticated-XPC foundation is implemented, but the release builder explicitly records `enforcementIncluded: false`. Do not install it as a daily-use enforcement tool yet. The next gate is to move the reviewed policy and enforcement flow behind this daemon/agent boundary, then sign, notarize, and run the second-Mac test matrix. The command-line prototype and JSON secret remain a local feasibility path, not a production installation boundary.
