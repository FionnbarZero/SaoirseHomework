# Fionnbar Homework App

A local-first homework application for Fionnbar's weekly path. The product plan is in `PROJECT_PLAN.md`.

## Run locally

```bash
npm install
npm run setup:proofreader
npm run dev
```

Open `http://127.0.0.1:4180`.

`npm run dev` starts both the Vite interface and the loopback data service. The service listens only on `127.0.0.1:4179` and stores its SQLite database in `data/homework.sqlite`.

Writing uses a local LanguageTool server when its official standalone package is installed under `~/.local/share/fionnbar-homework/LanguageTool-*`. `npm run dev` starts that loopback-only service automatically on `127.0.0.1:8081`; if it is unavailable, the app continues with its reviewed offline rules and says so in the writing screen. Draft text is never sent to the public LanguageTool API.

### Optional AI proofreading

The local checker remains the first pass. An optional, parent-controlled OpenAI second pass can run in four modes: **Off**, **Shadow** (measure findings without showing them), **Parent review** (non-blocking suggestions only), and **Guided practice** (high-confidence corrections become exercises while medium-confidence suggestions go to Parent review).

To make those modes available, copy `.env.example` to the untracked `.env` file and set both `OPENAI_API_KEY` and `HOMEWORK_OPENAI_MODEL`, then restart `npm run dev`. The API key stays in the local Node service. Each request contains only the current passage—never its title, Fionnbar's name/profile, prior drafts, or the Google writing log—and uses the Responses API with `store: false`. The model must return a strict JSON schema; the service rejects findings whose quoted text cannot be mapped exactly back to the submitted passage. The parent must explicitly choose a mode in **Parent → Writing review tools**; the default remains Off. Parent-review findings can be confirmed or dismissed, creating audit evidence for measuring false positives before Guided practice is enabled.

After `npm run build`, `npm start` serves the production build and API together from `http://127.0.0.1:4179`.

## Checks

```bash
npm test
npm run build
```

## Implemented in this milestone

- Child entry screen and Monday–Friday quest path
- Daily required activities and self-reported completion
- Daily Level Chinese and Du Chinese checklist activities with managed timers
- Cumulative nine-session weekly music practice bank
- Focus timers that pause when the tab is hidden
- Local reward-credit ledger and reward timer
- Local writing drafts with layered LanguageTool, reviewed contextual rules, and browser spelling assistance
- Optional schema-constrained AI second pass with Off, Shadow, Parent review, and high-confidence Guided practice modes
- One original-sentence correction plus three three-choice practice trials for every supported finding
- Reviewed spelling mistakes use the same original correction plus three multiple-choice reviews as the other writing areas
- A separate full-width correction-game frame followed by child revision and rechecking until no supported errors remain
- Restart-safe exercise progress and separately persisted version history; earlier writing is never overwritten
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
- Root-owned packaged service and SQLite directory with 15-second HMAC-authenticated lifecycle assertions
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
- Personalized reading-response writing with one original correction and three rule-matched trials per supported error
- Reviewed Grade 5 practice for perfect tense, safe tense consistency, correlative conjunctions, preposition pronouns, interjections, direct address, and the existing capitalization and punctuation rules
- Participation-based completion with first-attempt scoring, required unscored corrections, immediate rule feedback, stored accuracy, and a cumulative line graph
- Server-verified game evidence, clean-final-version completion, 24-hour sessions with safe expiry recovery, and replay rejection
- Persistent safe-mode Google connection and weekly delivery records
- Parent-authorized sync to one configured existing Google Doc, with writing attempts and corrections ordered newest first in an app-owned range
- Duplicate-safe local document assembly, original/corrected writing sections, real PDF export, and no-writing skip behavior
- Parent dashboard controls and downloadable proof artifacts with explicit no-send labeling
- Safe-by-default live Google foundation with Desktop OAuth PKCE and macOS Keychain refresh-token storage
- Drive/Docs weekly document creation, verified PDF export, view-only sharing, and Gmail attachment delivery
- Friday 12 p.m. queue, weekly idempotency, restart recovery, exponential retry, and parent retry/revoke controls
- Fail-closed delivery eligibility: a revision group can leave the Mac only after its final checked version has no supported errors
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
- Parent-created Google Cloud credentials and Family Link approval for the implemented live Google delivery path

The browser does not claim to enforce applications or URLs by itself. Those controls belong to the guardian and extension described in the project plan.

The managed Chrome extension supplies approved-origin and YouTube playback signals for external activities and rewards. The macOS guardian remains a prototype until it is parent-installed and tested on the child account, so application-level blocking is not yet a production enforcement boundary.

Parent controls now fail closed behind a native guardian authorization protocol. See [PARENT_AUTH_SETUP.md](PARENT_AUTH_SETUP.md). The production bundle includes a separate root-owned service launcher, a sealed Node runtime and server resources, and a root-only SQLite directory. Active lifecycle transitions carry short-lived HMAC assertions verified by the privileged daemon, so another process impersonating the loopback port cannot start or release a session. The signed login agent handles native Parent prompts and Google OAuth/Keychain operations; the daemon gives it only 15-second, scoped service grants and independently attests each Parent decision. Verified completion still requires the daemon's one-time capability and the matching Free-mode proof. Signing, notarization, recoverable upgrades, and second-Mac bypass testing are still required.

Configure tracked school activities from the Parent screen. Launch URLs must use HTTPS (loopback HTTP is accepted for local testing), and any login or redirect origins must be entered explicitly. A configured external activity still cannot start until the managed Chrome extension is connected.

The Parent screen's Google delivery proof remains deliberately local and is the default. It assembles saved writing into an HTML document and PDF, records one idempotent delivery per weekly document, and simulates sharing and email without contacting Google. Generated proof artifacts remain under `data/google-proof/`.

The live path is implemented but fail-closed until explicitly configured. In the packaged production architecture, the signed login agent performs Authorization Code with PKCE, token exchange, refresh, revocation, and login-Keychain storage; the root service receives only short-lived access tokens through its authenticated broker queue. It uses `drive.file` and `gmail.send`, a Friday queue, and one weekly delivery record. See [GOOGLE_SETUP.md](GOOGLE_SETUP.md). A revision group becomes delivery-eligible only after every game is complete and its latest checked version has no supported errors; the weekly document then includes every completed version in that group.

Weekly plans use `America/Los_Angeles` by default and roll over at 4:00 a.m. Sunday. Set `HOMEWORK_TIME_ZONE` to an IANA time-zone name only if the child Mac should follow a different school time zone.
