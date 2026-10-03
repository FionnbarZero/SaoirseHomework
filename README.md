# Fionnbar Homework App

A local-first browser prototype for Fionnbar's weekly homework path. The product plan is in `PROJECT_PLAN.md`.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4180`.

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
- Local browser persistence, responsive layout, and reduced-motion support

## Integration boundaries

The UI labels the following honestly as pending because they require external inputs or privileged installation:

- macOS guardian service and LaunchAgent
- Managed Chrome extension and policy profile
- Reading Strategies completion contract and game origin
- Google OAuth, Drive/Docs/Gmail delivery, and Family Link approval
- Existing spelling-practice module

The browser prototype does not claim to enforce applications or URLs. Those controls belong to the guardian and extension described in the project plan.
