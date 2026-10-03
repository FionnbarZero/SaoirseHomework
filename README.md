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
- Automatic migration from browser storage on the first service run
- Parent action audit log and restart-safe timer records
- Browser-cache fallback when the loopback service is unavailable
- Responsive layout and reduced-motion support

## Integration boundaries

The UI labels the following honestly as pending because they require external inputs or privileged installation:

- Parent-authorized guardian installation and enforcement on the second Mac
- Chrome Web Store publication and parent-installed policy on the second Mac
- Reading Strategies completion contract and game origin
- Google OAuth, Drive/Docs/Gmail delivery, and Family Link approval
- Existing spelling-practice module

The browser prototype does not claim to enforce applications or URLs. Those controls belong to the guardian and extension described in the project plan.

The session service verifies time reported by the browser, but the browser is not yet an enforcement boundary. The future macOS guardian and managed Chrome extension will supply approved-window, approved-origin, and application-blocking signals.
