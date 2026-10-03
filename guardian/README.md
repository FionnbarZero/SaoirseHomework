# macOS Guardian Prototype

This Swift command-line guardian is the first feasibility prototype for the child Mac. It reads the local homework service's requested mode, observes the frontmost application's bundle identifier, applies the service-provided blocked-app policy, and reports a heartbeat every five seconds.

The guardian is deliberately safe by default:

- Dry-run is the default and never closes an application.
- Enforcement requires both `allowEnforcement: true` in the parent-owned configuration and the `--enforce` command flag.
- `--simulate-homework` cannot be combined with enforcement.
- The service URL must be the loopback address `127.0.0.1`.
- The LaunchAgent file is a template only. Nothing installs or loads it automatically.

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

## Installation boundary

Do not enable enforcement or load the LaunchAgent on a daily-use account. The next feasibility step is to create the standard child account on the second Mac, copy a reviewed configuration into a parent-owned location, fill the absolute paths in the LaunchAgent template, and test recovery while a parent is present.
