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
- Local writing drafts with deterministic grammar, capitalization, punctuation, and reviewed common-misspelling checks
- One original-sentence correction plus five three-choice practice trials for every supported finding
- Restart-safe spelling practice with three visible copies, three hidden responses, and three mixed-review responses per word
- Restart-safe exercise progress, unchanged original drafts, and separately persisted corrected copies
- Parent-editable capitalization dictionaries for known names and places
- Persistent, non-blocking parent review queue for ambiguous repeated-word, tense, and run-on suggestions
- Parent preview dashboard and completion overrides
- macOS administrator authorization challenges for Parent controls, with no password field in the web app
- Ten-minute HttpOnly parent sessions, explicit lock, sensitive-action reauthorization, and restart revocation
- Server-enforced protection for parent overrides, rewards, writing review tools, URLs, Google controls/artifacts, audit history, and reset
- Enforcing-mode recovery lock when the guardian, managed Chrome, or local service fails during Homework mode
- Checksum-protected second-Mac guardian review bundles with signed-binary, standard-user, ownership, dry-run, and secret-exclusion gates
- Root-owned dry-run installation, health checks, recoverable uninstall, and exact-backup rollback tooling
- `SMAppService` parent-app, user-agent, and privileged-daemon production foundation
- Authenticated XPC pinned to one Apple team and exact parent/agent/daemon identifiers
- Fresh, replay-protected administrator authorization references with a root-owned mode-and-policy audit log
- Root-owned, parent-authorized blocked-app policy with validated identifiers and audited revisions
- Signed session-agent enforcement of only daemon-issued frontmost-application decisions
- Server-issued daily child-session IDs with daemon-held completion capabilities and verified Free-mode proofs
- Production-app signing and notarization reports that stay non-production until second-Mac acceptance
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
- Duplicate-safe local document assembly, original/corrected writing sections, real PDF export, and no-writing skip behavior
- Parent dashboard controls and downloadable proof artifacts with explicit no-send labeling
- Safe-by-default live Google foundation with Desktop OAuth PKCE and macOS Keychain refresh-token storage
- Drive/Docs weekly document creation, verified PDF export, view-only sharing, and Gmail attachment delivery
- Friday 4 p.m. queue, weekly idempotency, restart recovery, exponential retry, and parent retry/revoke controls
- Fail-closed delivery eligibility: only writing explicitly marked complete can leave the Mac
- Sunday 4:00 a.m. **Get a Head Start** screen with optional activities only
- Friday Fun celebration with a weekly recap and persisted, audited Free Mode unlock
- Parent-reviewed URL and exact-origin configuration for Ninja Dojo, Du Chinese, and Level Chinese
- Managed-Chrome activity phases: 17-minute Ninja, 13+7-minute Du Chinese, and Clever-gated Level Learning
- Dynamic activity allowlists, five-second origin heartbeats, fail-closed launch gates, and restart-safe phase recovery
- Controlled YouTube reward windows with a two-minute selection period and automatic focus restoration
- Extension-verified foreground playback that excludes pauses, buffering, ads, and time outside YouTube
- Partial reward recovery after cancellation or restart, plus automatic credit return when no video starts
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
- Parent-created Google Cloud credentials and Family Link approval for the implemented live Google delivery path

The browser does not claim to enforce applications or URLs by itself. Those controls belong to the guardian and extension described in the project plan.

The managed Chrome extension supplies approved-origin and YouTube playback signals for external activities and rewards. The macOS guardian remains a prototype until it is parent-installed and tested on the child account, so application-level blocking is not yet a production enforcement boundary.

Parent controls now fail closed behind a native guardian authorization protocol. See [PARENT_AUTH_SETUP.md](PARENT_AUTH_SETUP.md). The signed agent starts daemon-owned Homework sessions from server-issued daily IDs. Verified completion can release a session only with both the daemon's one-time capability and the service's matching Free-mode proof; parent exits remain administrator-authorized. Packaging the loopback service and SQLite behind a parent-owned boundary, notarization, and second-Mac bypass testing are still required.

Configure tracked school activities from the Parent screen. Launch URLs must use HTTPS (loopback HTTP is accepted for local testing), and any login or redirect origins must be entered explicitly. A configured external activity still cannot start until the managed Chrome extension is connected.

To connect the production reading game, set `HOMEWORK_READING_GAME_URL` to its launch URL and `HOMEWORK_READING_GAME_ORIGIN` to that URL's exact origin. The game receives the one-time session data in the URL fragment and must POST the nonce to the supplied completion URL.

The Parent screen's Google delivery proof remains deliberately local and is the default. It assembles saved writing into an HTML document and PDF, records one idempotent delivery per weekly document, and simulates sharing and email without contacting Google. Generated proof artifacts remain under `data/google-proof/`.

The live path is implemented but fail-closed until explicitly configured. It uses Authorization Code with PKCE, a loopback callback, macOS Keychain refresh-token storage, `drive.file` and `gmail.send`, a Friday queue, and one weekly delivery record. See [GOOGLE_SETUP.md](GOOGLE_SETUP.md). The writing flow marks a draft `complete` only after every supported correction and spelling response is finished; only complete drafts are eligible for live delivery.

Weekly plans use `America/Los_Angeles` by default and roll over at 4:00 a.m. Sunday. Set `HOMEWORK_TIME_ZONE` to an IANA time-zone name only if the child Mac should follow a different school time zone.
