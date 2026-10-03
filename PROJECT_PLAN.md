# Fionnbar Homework App — Project Plan

## 1. Purpose and current decisions

Fionnbar Homework App is a browser-based learning path paired with a macOS guardian. Fionnbar will use a standard child account on a separate Mac. His parent will retain the only administrator account and password.

The child intentionally starts a homework session by visiting the app URL and clicking **Enter**. Household enforcement begins at that moment. The first version will not require MDM enrollment.

The system has three goals:

1. Present a clear Monday–Friday learning path.
2. Keep tracked activities in a controlled session for the required duration or until a verified completion event arrives.
3. Restore ordinary access to Fionnbar's standard account after the applicable daily and weekly requirements are satisfied.

## 2. Enforcement boundary

### What household enforcement can do

With Fionnbar using a standard account and the parent retaining the administrator password, the installed guardian can:

- Start a protected session after Fionnbar clicks **Enter**.
- Close or reject Roblox, Safari, Terminal, unapproved browsers, and unrelated applications during Homework mode.
- Restrict managed Chrome to the learning path, the currently approved activity, or an active YouTube reward.
- Disable Chrome Guest mode, Incognito mode, developer tools, and unauthorized extensions through managed policy.
- Detect ordinary attempts to close or leave a timed activity, reopen it, and resume the unearned portion of its timer.
- Protect configuration, progress records, Chrome policy, and the guardian behind administrator authorization.
- Continue incomplete sessions after browser crashes, account logout, restart, or sleep without crediting inactive time.

### What household enforcement cannot guarantee

Without MDM-backed Autonomous Single App Mode, the app cannot make the Mac physically inescapable. It cannot prevent:

- Powering off the Mac.
- Booting into Recovery or Safe Mode.
- Erasing or reinstalling macOS.
- Bypass by anyone who knows the parent administrator password.
- Temporary visual interruption during an application or system crash.

These actions never grant activity credit. On the next normal child login, the guardian restores the incomplete state. MDM-backed kiosk mode remains a possible later hardening phase, not a version-one dependency.

## 3. Child interface

### Entry and weekly path

- The child opens the homework URL and sees a simple **Enter** button.
- Clicking **Enter** begins household enforcement and opens the weekly path.
- The path winds through five markers:
  - Monday through Thursday are equal-size dots in one shared color.
  - Friday is larger, surrounded by a golden star, and labeled **Friday Fun!**
- Selecting a day opens that day's activities.
- Friday Fun becomes a celebration screen after the Friday requirements are met. It displays a golden animation, the week's completed activities, writing totals, practice totals, and earned rewards. It does not silently add unapproved screen time.

### Activity state control

- Every activity has a label and a status control aligned on the right.
- Incomplete appears as a red circle with a line through it.
- Complete appears as a green check.
- Self-reported activities allow Fionnbar to change the control.
- Tracked activities update only from the guardian or an approved completion event.
- Completion records show whether they were self-reported, time-in-session tracked, game-verified, or parent-overridden.

## 4. Required daily activities

| Activity | Completion method | Rule |
|---|---|---|
| Mandarin Daily Work | Self-reported | Fionnbar changes the control to a green check. |
| Daily Math Practice | Self-reported | Fionnbar changes the control to a green check. |
| Daily English Packet | Self-reported | Fionnbar changes the control to a green check. |
| Reading Strategies Game | Game-verified | Complete only after the game sends an approved completion event. |
| Ninja Dojo | Time-in-session | Open 5th Grade Learning Hub in a controlled view for 17 active minutes. |
| English Escape | Coming soon | Visible but excluded from completion until its app is ready; future duration is 10 active minutes. |

Self-reported completion is intentionally honor-based. The parent dashboard records and can correct it.

## 5. Optional weekly activities and banking

The weekly optional pool returns to 13 regular sessions:

| Activity | Weekly sessions | Session behavior |
|---|---:|---|
| Voena | 3 | Controlled 20-minute visual practice timer |
| Drum Drills | 3 | Controlled 20-minute visual practice timer |
| Band Practice | 3 | Controlled 20-minute visual practice timer |
| Level Chinese | 2 | Clever login followed by 20 active minutes in Level Learning |
| Du Chinese | 2 | 13 active reading minutes followed by 7 active flashcard minutes |

There are no extra wildcard sessions in the revised model.

### Segmented icons

- Voena, Drum Drills, and Band Practice appear as icons divided into thirds.
- Level Chinese and Du Chinese appear as icons divided into halves.
- Selecting a segment opens a card such as **Voena — Session 2**.
- A completed segment remains green and cannot be counted twice.
- Fionnbar may complete multiple segments from the same activity on one day.

### Weekly pacing and banking

- The upcoming week's pool opens on Sunday at 4:00 a.m. through a **Get a Head Start** screen containing optional activities only.
- Fionnbar may complete any number of the 13 optional sessions on Sunday or a later day.
- Every early completion is banked against the same upcoming week.
- The pacing targets are cumulative, not rigid daily assignments:
  - Monday: 3 of 13 banked
  - Tuesday: 6 of 13 banked
  - Wednesday: 9 of 13 banked
  - Thursday: 11 of 13 banked
  - Friday: all 13 banked
- Completing more than the current target reduces or eliminates later optional requirements.
- Example: six completions on Sunday and seven on Monday finish all 13; no further optional sessions are required that week.
- Ordinary daily access requires all active required activities for that day plus satisfaction of that day's cumulative optional target. If the weekly total is already 13, only the required daily activities remain.
- The optional pool resets for the next week on Sunday at 4:00 a.m. Previous history is archived.

## 6. Controlled activity sessions

### Common behavior

- A controlled session receives a unique session ID, activity ID, target duration, current phase, remaining active seconds, and one-time session nonce.
- The guardian counts only active, approved foreground time.
- It writes a heartbeat and elapsed time at least every five seconds.
- Sleep, shutdown, logout, loss of approved focus, browser crash, or network outage does not count toward the timer.
- Reopening resumes the saved remaining time.
- Ordinary close, navigation, and app-switch attempts are reversed by the guardian and do not complete the activity.
- A parent-authenticated emergency exit always exists and leaves the activity incomplete unless the parent explicitly overrides it.
- **Return to Learning Path** appears only after verified completion or timer expiration.

### Reading Strategies Game

- Launch the game currently under development.
- The guardian issues a one-time session nonce.
- The game reports `activityComplete` with the session ID and nonce.
- The local service accepts the event only from the configured game origin and only once.
- Elapsed time alone and child-controlled UI cannot complete this activity.

### Ninja Dojo

- Open the configured 5th Grade Learning Hub entry point.
- Allow the exact entry origin plus reviewed login, asset, and child-page redirect origins.
- Count 17 active foreground minutes.
- Then show **Return to Learning Path** and record time-in-session completion.

### English Escape

- Initially show **Coming Soon**.
- Do not include it in daily requirements.
- Preserve a configurable integration slot.
- When activated later, require 10 active foreground minutes before return.

### Voena, Drum Drills, and Band Practice

- Use a shared 20-minute visual timer.
- Show one activity-specific instruction:
  - **Practice Voena**
  - **Practice Drums**
  - **Practice Band Vocals**
- Also display **More Coming Soon**.
- These sessions verify time in the approved practice screen, not the physical quality of practice.

### Du Chinese

- Configure one reading URL and one flashcard URL.
- Run 13 active foreground minutes at the reading stage.
- Transition automatically to the flashcard stage for 7 active foreground minutes.
- Allow only reviewed Du Chinese origins and required redirects.
- Record time-in-session completion after the full 20 active minutes.

### Level Chinese

- Show **Log in through Clever** first.
- Allow the reviewed Clever and district identity-provider redirects.
- Enable **Enter Level Learning** after login succeeds.
- Count 20 active foreground minutes in the reviewed Level Learning origins.
- Record time-in-session completion after the timer expires.

## 7. Entertainment reward system

Entertainment rewards are distinct from optional activity segments.

### Earning and banking

- A configured task or milestone earns one five-minute entertainment reward credit by default.
- A writing milestone earns its credit only after its correction exercises are complete.
- When a credit is earned, show **Use Now** and **Save for Later**.
- Credits persist across pauses, sleep, restart, and multiple homework sessions.
- Credits remain available while Homework mode is active for the current day.
- When Free mode begins, unused credits are archived because YouTube is then ordinarily available.
- The parent dashboard can add, remove, or correct credits with an audit note.

### YouTube reward in version one

- YouTube is the only enabled entertainment choice in version one.
- Roblox and Codex appear only as disabled future choices and cannot be launched.
- Redeeming a credit opens a separate controlled YouTube window.
- Fionnbar may browse and choose any YouTube video.
- Allow a two-minute selection period before playback.
- If no video begins, close YouTube and return the unused credit.
- Start the five-minute reward timer when video content begins playing.
- Count cumulative content playback only; pauses, buffering, and detected advertisements do not count.
- Allow changing videos during the same reward while preserving the cumulative timer.
- At five content minutes, close every YouTube tab or window, restore the Homework-mode block, and return to the prior learning-path or writing screen.
- If Chrome crashes, preserve the unused seconds and let Fionnbar resume the same credit.
- Store YouTube reward credits separately from optional weekly session progress in both data and UI.

### Future rewards

- Roblox may later become a timed application reward.
- Codex may later become a controlled application reward.
- Neither is part of version one, and neither may weaken Homework-mode controls before its own safety design is approved.

## 8. Writing and correction module

Writing tasks are supported but are not automatically equivalent to Daily English Packet. A parent assigns them separately or links them to an English task.

### Drafting

- Fionnbar writes in the homework app, not directly in Google Docs.
- Disable browser spellcheck, autocorrect, grammar hints, punctuation hints, and automatic capitalization in the editor.
- Save the untouched draft before correction begins.
- Analyze writing locally; do not send it to an AI service.
- Recognized findings use four categories: spelling, grammar, punctuation, and capitalization.
- Only high-confidence supported rules generate mandatory exercises.
- Unsupported or ambiguous findings enter the parent review queue and do not block completion.

### Version-one deterministic rule set

- Grammar:
  - Basic subject–verb agreement
  - Simple present/past tense consistency
  - `a` versus `an`
  - Common singular/plural agreement
  - Common pronoun agreement
- Punctuation:
  - Terminal periods, question marks, and exclamation marks
  - Commas after recognized introductory clauses
  - Commas in simple lists
  - Common contraction and possessive apostrophes
  - Paired quotation marks
- Capitalization:
  - Sentence beginnings
  - The pronoun `I`
  - Days and months
  - Known names and places from a parent-editable dictionary
  - Recognized titles

Each rule requires reviewed positive examples, distractors, and regression tests. The app must never claim that all English errors are detectable.

### Exercise flow

- Grammar: show the original sentence and three corrections; after the correct selection, require five similar three-choice trials.
- Punctuation: use the same original-error plus five-practice-trials model.
- Capitalization: show three versions with different capitalization; after the correct selection, require five similar trials.
- Incorrect answers receive immediate feedback and do not advance the five-trial counter.
- Spelling uses the separately developed show/copy and hide/respond module through an adapter:
  1. Hear and see the word, then copy it three times.
  2. Hear the hidden word, then type it correctly three times.
  3. Complete a mixed hidden review of every misspelled word three times.
- The writing task completes only after every supported correction exercise completes.
- Until the spelling module is supplied and integrated, the writing feature remains pre-release rather than silently ignoring spelling errors.

## 9. Google document and Friday delivery

### Account and storage

- Use Fionnbar's parent-managed consumer Gmail account. It is not a school-managed Workspace account.
- The parent must allow the homework app under Family Link's third-party app controls before OAuth authorization.
- Store OAuth refresh credentials in the macOS Keychain.
- Never store the Google password.
- Create:
  - `My Drive/Fionnbar Homework/<School Year>/Writing`
- Maintain one document per week named:
  - `Fionnbar Writing — Week of <Monday date>`
- Append each completed writing task with its title, date, untouched draft, corrected version, and short practice summary.

### Friday behavior

- At 4:00 p.m. Friday, send whatever completed writing exists at that moment. Do not delay for unfinished Friday work.
- Export and verify a PDF.
- Share the Google Doc as view-only with one configured school address.
- Send a separate email from Fionnbar's authorized Google account containing the PDF and link.
- If no writing exists, send nothing and record the skipped delivery.
- If the Mac is asleep or offline, queue the message and send it once the child service next has internet and Keychain access.
- Use the week ID and Google document ID as an idempotency key so the same week cannot send twice accidentally.
- If sharing fails but PDF export and Gmail work, send the PDF, log the missing link, and notify the parent.
- The parent dashboard can inspect status and retry a failed delivery, but routine Friday sending requires no approval.

### Google authorization setup and proof

Before building the full document feature:

1. In Family Link, select Fionnbar, open **Controls → Account settings → Controls for third-party apps**, and allow trusted third-party access.
2. Create a Google Cloud project owned by the parent's Google account.
3. Enable Google Drive API, Google Docs API, and Gmail API.
4. Configure the OAuth consent screen for external testing and add Fionnbar's Gmail address as a test user.
5. Create a **Desktop app** OAuth client.
6. Implement Authorization Code with PKCE and a loopback redirect.
7. Request only the minimum scopes: identity, `drive.file`, and `gmail.send`. Use a broader Docs scope only if a tested Docs operation cannot use `drive.file`.
8. Authorize from Fionnbar's profile while the parent is available to approve access, then store the refresh token in Keychain.
9. Confirm the new connection appears in Family Link under **Manage third-party app access**.
10. Run a proof that creates a test folder and Doc, appends text, shares it with a parent test address, exports PDF, and sends one test email.
11. Remove the connection through Family Link and confirm the app detects revocation cleanly before authorizing it again for production.

If Family Link refuses one of the requested scopes, do not bypass the restriction. The fallback is to authorize a parent-owned Gmail account for document delivery while continuing to label the work as Fionnbar's.

## 10. Chrome extension deployment

### Deployment plan for the second Mac

1. Create the child standard macOS account and preserve the parent as the sole administrator.
2. Build the Chrome extension with a fixed signing key so its extension ID remains stable.
3. Package it as a `.crx` with a controlled update manifest, or publish it as an unlisted Chrome Web Store extension if self-hosted updates are rejected by the installed Chrome version.
4. Install a parent-authorized Chrome configuration profile that:
   - Force-installs the extension.
   - Blocks other extensions by default.
   - Disables Guest and Incognito modes during Homework mode.
   - Disables Chrome developer tools for the child profile.
   - Applies the guardian's approved URL policy.
5. Verify the effective configuration in `chrome://policy` while signed into Fionnbar's macOS account.
6. Confirm Fionnbar cannot disable or remove the extension.
7. Confirm the parent account remains unrestricted or can disable Homework mode through administrator authorization.
8. Repeat the policy verification after Chrome updates.

The extension and guardian must fail closed during Homework mode: if either loses communication, controlled activities pause and no completion credit is granted.

## 11. Local architecture and persistence

- Child and parent web UI: React, TypeScript, and Vite.
- Child URL: fixed loopback address served by the local application service.
- Persistence: SQLite database owned by the application service and not writable by the child account.
- macOS enforcement: parent-installed guardian service plus child-session LaunchAgent.
- Browser control: force-installed Chrome extension with native messaging to the guardian.
- Google integration: Drive, Docs, and Gmail APIs.
- Secrets: macOS Keychain and administrator-protected configuration; never source control.

### State records

- `WeeklyPlan`: start date, 13 optional segments, cumulative pacing targets, and archive status.
- `DailyPlan`: date, required activities, cumulative optional target, and Free-mode state.
- `ActivitySession`: session ID, activity, phase, target seconds, credited seconds, last heartbeat, nonce, and result.
- `CompletionRecord`: method, timestamp, source, override status, and audit note.
- `RewardCredit`: earned source, total seconds, remaining seconds, state, and redemption history.
- `WritingSubmission`: original draft, corrected draft, supported findings, exercises, and export state.
- `GoogleDelivery`: week, document ID, PDF result, recipient, send result, idempotency key, and retry history.
- `ParentOverride`: authorizing administrator, duration, reason, start, and end.

Database transactions make completion, reward earning, and timer updates atomic. Duplicate completion events, repeated browser messages, and restarts cannot award duplicate credit.

## 12. Parent dashboard and child-data controls

Parent functions require macOS administrator authorization rather than a child-visible PIN.

The dashboard can:

- Configure activity URLs, redirect domains, durations, schedules, and active status.
- Review and correct completion history with an audit reason.
- Review active and interrupted timers.
- Add or remove entertainment reward credits.
- Review, edit, export, or delete local writing drafts.
- Review ambiguous writing findings.
- Change the school email recipient.
- Review and retry Google deliveries.
- Revoke Google authorization and delete stored OAuth tokens.
- Export activity history as a parent-readable file.
- End an override early or unlock for 15 minutes, one hour, or the rest of the day.
- Delete a school year's local records after explicit confirmation.

Default retention:

- Keep detailed activity and reward records for the current and previous school years.
- Keep Google documents until the parent deletes them in Drive.
- Keep delivery logs for 13 months.
- Never automatically delete teacher-delivered writing.

## 13. Recovery and failure rules

- Clock or timezone changes never add timer credit; active duration uses a monotonic clock.
- Changing the calendar cannot reset a day, week, or reward ledger twice.
- A missed weekday remains archived as missed; it is not silently marked complete.
- Sunday head-start work applies only to the immediately upcoming weekly plan.
- Network loss pauses external web activity timers unless the approved page remains fully available and verifiably foregrounded.
- Clever or Google login redirects outside the reviewed allowlist pause the session and show a parent-readable error.
- Revoked Google authorization stops delivery, preserves the weekly document locally, and requests parent reauthorization.
- Rejected teacher email or blocked file sharing creates a visible failure record and parent notification.
- Chrome update incompatibility pauses tracked browser sessions rather than granting credit.
- Disabled or missing extension state prevents Homework mode from starting and requests parent repair.
- Guardian failure causes the child UI to enter a locked recovery screen; it never awards completion while enforcement is unavailable.

## 14. Test and acceptance plan

### Interface

- Verify the five path markers, Friday star, segmented optional icons, self-report controls, and Friday celebration.
- Verify Sunday **Get a Head Start** behavior.
- Verify accessibility labels, keyboard navigation, readable contrast, and reduced-motion behavior.

### Banking and access

- Test cumulative totals of 0–13 across Sunday–Friday.
- Test the example of six Sunday sessions plus seven Monday sessions.
- Confirm early work reduces later cumulative requirements.
- Confirm daily required work remains required even after all optional work is banked.
- Confirm Free mode resets on the next child login after 4:00 a.m. without resetting the weekly pool.

### Controlled sessions

- Test every timer, phase transition, redirect, close attempt, app switch, crash, restart, logout, sleep, and offline recovery.
- Confirm elapsed wall-clock downtime never becomes credited activity time.
- Confirm parent emergency exits and overrides.
- Confirm Reading Strategies accepts one valid completion and rejects wrong-origin, wrong-nonce, expired, and duplicate events.

### Rewards

- Test earning, immediate use, banking, partial use, restart recovery, and archive on Free mode.
- Verify two-minute YouTube selection, five cumulative content minutes, pause/buffer/ad exclusion, video changes, forced closure, and focus restoration.
- Verify entertainment credits never alter optional session totals.

### Writing

- Test each supported grammar, punctuation, and capitalization rule with positive, negative, and ambiguous examples.
- Confirm each original supported error produces one correction plus five practice trials.
- Confirm incorrect choices do not advance the counter.
- Confirm original drafts remain unchanged and corrected drafts contain only accepted changes.
- Run the supplied spelling module's regression tests before enabling writing completion.

### Google and Chrome

- Test OAuth approval, denial, token refresh, revocation, school-policy blocking, Drive creation, Doc updates, PDF export, sharing, email, offline queueing, and duplicate prevention.
- Test Chrome policy after installation and browser updates.
- Confirm the child cannot remove the extension, enable Guest/Incognito, open developer tools, or modify managed settings.

## 15. Required external inputs

- The exact Reading Strategies game project and its integration origin.
- The 5th Grade Learning Hub entry URL and required redirect origins.
- The Du Chinese reading and flashcard URLs.
- The Clever login, district identity-provider, and Level Learning origins.
- The existing modular spelling-practice code.
- The school delivery email address.
- Access to the second Mac for child-account, guardian, and Chrome-policy testing.
- Parent approval of the homework app in Family Link's third-party app controls.

## 16. Delivery phases

1. **Feasibility prototypes:** second-Mac child account, guardian recovery, Chrome forced-extension policy, Google OAuth/send proof, and Reading Strategies completion contract.
2. **Core learning path:** entry screen, weekly path, daily lists, self-reporting, segmented optional pool, Sunday head start, banking, persistence, and parent dashboard.
3. **Controlled activities:** generic timer shell, Ninja Dojo, practice timers, Du Chinese, Level Chinese, and Reading Strategies integration.
4. **Rewards:** earning ledger, banked credits, controlled YouTube playback, recovery, and focus restoration.
5. **Writing:** deterministic language rules, correction games, spelling-module integration, weekly Google document, and Friday delivery.
6. **Hardening:** failure recovery, privacy controls, accessibility, Chrome-update testing, child-account bypass testing, and optional MDM evaluation.
