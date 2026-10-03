# Fionnbar Homework App

A local-first homework application for Fionnbar's weekly path. The product plan is in `PROJECT_PLAN.md`.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4180`.

`npm run dev` starts both the Vite interface and the loopback data service. The service listens only on `127.0.0.1:4179` and stores its SQLite database in `data/homework.sqlite`.

After `npm run build`, `npm start` serves the production build and API together from `http://127.0.0.1:4179`.

## Checks

```bash
npm test
npm run build
```

## Implemented in this milestone

- Child entry screen and Monday–Friday quest path
- Daily required activities and self-reported completion
- Cumulative 13-session weekly practice bank
- Focus timers that pause when the tab is hidden
- Local reward-credit ledger and reward timer
- Local writing draft with deterministic capitalization and punctuation checks
- Parent preview dashboard and completion overrides
- SQLite persistence for daily completions, optional sessions, rewards, writing, and active timers
- Server-owned controlled sessions with unique IDs and fixed activity durations
- Five-second focus heartbeats using monotonic elapsed time
- Fail-closed pause and recovery after focus loss, long heartbeat gaps, or service restart
- Atomic completion records with self-reported, parent-override, and time-in-session sources
- Duplicate-safe optional completion and reward-credit creation
- Native Swift macOS guardian prototype with a live service heartbeat
- Safe-by-default dry-run app-policy checks and an uninstalled LaunchAgent template
- Manifest V3 managed-Chrome prototype with a stable development ID
- Dynamic Homework-mode navigation rules and a parent-reviewed policy template
- One-time Reading Strategies game sessions with hashed nonces and a 60-minute expiry
- Exact-origin CORS, atomic `game-verified` completion, and replay rejection
- Child-screen game launch, status polling, and a clearly labeled local verification simulator
- Persistent safe-mode Google connection and weekly delivery records
- Duplicate-safe local document assembly, real PDF export, and no-writing skip behavior
- Parent dashboard controls and downloadable proof artifacts with explicit no-send labeling
- Sunday 4:00 a.m. **Get a Head Start** screen with optional activities only
- Friday Fun celebration with a weekly recap and persisted, audited Free Mode unlock
- Parent-reviewed URL and exact-origin configuration for Ninja Dojo, Du Chinese, and Level Chinese
- Managed-Chrome activity phases: 17-minute Ninja, 13+7-minute Du Chinese, and Clever-gated Level Learning
- Dynamic activity allowlists, five-second origin heartbeats, fail-closed launch gates, and restart-safe phase recovery
- Week-scoped daily and practice ledgers with archived rollover history
- Stale-week and clock-rollback protection so a week cannot reset twice
- Automatic migration from browser storage on the first service run
- Parent action audit log and restart-safe timer records
- Browser-cache fallback when the loopback service is unavailable
- Responsive layout and reduced-motion support

## Integration boundaries

The UI labels the following honestly as pending because they require external inputs or privileged installation:

- Parent-authorized guardian installation and enforcement on the second Mac
- Chrome Web Store publication and parent-installed policy on the second Mac
- The production Reading Strategies game project and its exact integration origin (the local simulator exercises the completed contract)
- Live Google OAuth, Drive/Docs/Gmail delivery, Keychain storage, and Family Link approval (a no-network local proof is implemented)
- Existing spelling-practice module

The browser prototype does not claim to enforce applications or URLs. Those controls belong to the guardian and extension described in the project plan.

The session service verifies time reported by the browser, but the browser is not yet an enforcement boundary. The future macOS guardian and managed Chrome extension will supply approved-window, approved-origin, and application-blocking signals.

Configure tracked school activities from the Parent screen. Launch URLs must use HTTPS (loopback HTTP is accepted for local testing), and any login or redirect origins must be entered explicitly. A configured external activity still cannot start until the managed Chrome extension is connected.

To connect the production reading game, set `HOMEWORK_READING_GAME_URL` to its launch URL and `HOMEWORK_READING_GAME_ORIGIN` to that URL's exact origin. The game receives the one-time session data in the URL fragment and must POST the nonce to the supplied completion URL.

The Parent screen's Google delivery proof is deliberately local. It assembles saved writing into an HTML document and PDF, records one idempotent delivery per weekly document, and simulates sharing and email without contacting Google. Generated proof artifacts remain under `data/google-proof/`. Live mode must use Authorization Code with PKCE, macOS Keychain token storage, minimal Drive/Gmail scopes, and explicit Family Link approval before it can replace the simulator.

Weekly plans use `America/Los_Angeles` by default and roll over at 4:00 a.m. Sunday. Set `HOMEWORK_TIME_ZONE` to an IANA time-zone name only if the child Mac should follow a different school time zone.
