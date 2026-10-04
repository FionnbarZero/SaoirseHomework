# macOS Guardian Prototype

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

The next production gate is the signed `SMAppService` agent/daemon and authenticated XPC boundary described in the deployment guide. The command-line prototype and JSON secret remain a feasibility path, not a production installation boundary.
