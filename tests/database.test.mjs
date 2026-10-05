import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createStore, getWeekContext } from '../server/database.mjs'
import { inspectDraft, inspectWritingFindings } from '../src/writing.ts'

function sampleState() {
  return {
    entered: true,
    requiredByDay: {
      Monday: ['mandarin', 'math'],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
    },
    optionalCompleted: ['voena:0'],
    rewardCredits: [{
      id: 'credit-1',
      source: 'Voena · Session 1',
      remainingSeconds: 300,
      earnedAt: '2026-10-03T07:00:00.000Z',
    }],
    drafts: [{
      id: 'draft-1',
      readingDate: '2026-10-03',
      title: 'A test draft',
      author: 'Ursula K. Le Guin',
      pagesRead: '34–52',
      body: 'Today I receive a persistence test.',
      correctedBody: 'Today I receive a persistence test.',
      updatedAt: '2026-10-03T07:00:00.000Z',
      findings: [],
      exerciseProgress: { example: { correctionComplete: true, practiceCompleted: 5, incorrectAttempts: 1 } },
      spellingWords: [],
      spellingProgress: {},
      reviewStatus: 'complete',
    }],
    writingDictionary: { knownNames: ['Fionnbar', 'Ms. Rivera'], knownPlaces: ['San Francisco'] },
    writingReviewQueue: [{
      id: 'draft-1:repeated-word-4',
      draftId: 'draft-1',
      category: 'Grammar',
      message: 'A word may repeat.',
      excerpt: 'The the dog ran.',
      status: 'pending',
      createdAt: '2026-10-03T07:00:00.000Z',
    }],
    activeTimer: {
      kind: 'required',
      activityId: 'ninja-dojo',
      sessionKey: 'Monday',
      label: 'Ninja Dojo',
      totalSeconds: 1020,
      remainingSeconds: 917,
      running: false,
    },
    activeGameSession: null,
    completionRecords: [],
    guardianConnected: false,
    chromeConnected: false,
  }
}

test('SQLite state survives closing and reopening the service', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-homework-'))
  const filename = join(directory, 'homework.sqlite')

  try {
    const first = createStore(filename)
    assert.equal(first.isInitialized(), false)
    first.saveState(sampleState())
    first.addAudit('parent_completion_override', { day: 'Monday', activityId: 'math' })
    assert.equal(first.isInitialized(), true)
    first.close()

    const reopened = createStore(filename)
    const restored = reopened.loadState()
    assert.deepEqual(restored.requiredByDay.Monday, ['mandarin', 'math'])
    assert.deepEqual(restored.optionalCompleted, ['voena:0'])
    assert.equal(restored.rewardCredits[0].remainingSeconds, 300)
    assert.equal(restored.drafts[0].readingDate, '2026-10-03')
    assert.equal(restored.drafts[0].title, 'A test draft')
    assert.equal(restored.drafts[0].author, 'Ursula K. Le Guin')
    assert.equal(restored.drafts[0].pagesRead, '34–52')
    assert.equal(restored.drafts[0].correctedBody, 'Today I receive a persistence test.')
    assert.equal(restored.drafts[0].exerciseProgress.example.practiceCompleted, 5)
    assert.deepEqual(restored.drafts[0].spellingWords, [])
    assert.equal(restored.drafts[0].reviewStatus, 'complete')
    assert.deepEqual(restored.writingDictionary.knownPlaces, ['San Francisco'])
    assert.equal(restored.writingReviewQueue[0].status, 'pending')
    assert.equal(restored.activeTimer.remainingSeconds, 917)
    assert.equal(restored.activeTimer.status, 'paused')
    assert.equal(restored.activeTimer.serverControlled, true)
    assert.equal(reopened.info().schemaVersion, 28)
    assert.equal(reopened.listAudit()[0].eventType, 'parent_completion_override')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stored writing quizzes migrate away from mechanically generated distractors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-quiz-choice-migration-'))
  const filename = join(directory, 'homework.sqlite')

  try {
    const first = createStore(filename)
    const state = sampleState()
    state.activeTimer = null
    state.drafts[0].body = 'today we begin.'
    state.drafts[0].correctedBody = 'today we begin.'
    state.drafts[0].exerciseProgress = {}
    state.drafts[0].reviewStatus = 'practice'
    first.saveState(state)

    const finding = inspectDraft(state.drafts[0].body)[0]
    const staleFinding = {
      ...finding,
      correction: {
        ...finding.correction,
        choices: ['today we begin.', 'Today we begin.', 'Ttoday we begin.'],
      },
    }
    first.db.prepare(`UPDATE writing_submission SET findings_json = ? WHERE id = ?`)
      .run(JSON.stringify([staleFinding]), state.drafts[0].id)
    first.db.prepare(`DELETE FROM app_meta WHERE key = 'reviewed_quiz_choice_quality_v1_migrated'`).run()
    first.close()

    const reopened = createStore(filename)
    const migrated = reopened.loadState().drafts[0].findings[0]
    assert.deepEqual(new Set(migrated.correction.choices), new Set([
      'today we begin.',
      'Today we begin.',
    ]))
    assert.equal(
      reopened.listAudit().some((event) => event.eventType === 'writing_quiz_choices_rebuilt'),
      true,
    )
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('AI parent-review suggestions remain attached to their draft across saves', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.activeTimer = null
  state.drafts[0].body = 'Noone knows.'
  state.drafts[0].correctedBody = 'Noone knows.'
  state.drafts[0].reviewSuggestions = [{
    id: 'ai-no-one-0-5',
    category: 'Spelling',
    message: 'Use two words when this means “not anyone.”',
    excerpt: 'Noone knows.',
    explanation: '“No one” is written as two words.',
    suggestion: 'No one',
    replacement: 'No one',
    alternatives: ['No one'],
    start: 0,
    end: 5,
    ruleId: 'AI_CONTEXTUAL_SPELLING',
    source: 'ai',
    confidence: 'medium',
  }]

  const imported = store.saveState(state)
  const aiItem = imported.writingReviewQueue.find((item) => item.source === 'ai')
  assert.ok(aiItem)
  assert.equal(aiItem.status, 'pending')
  assert.equal(imported.drafts[0].reviewSuggestions.some((item) => item.source === 'ai'), true)

  const confirmed = store.setWritingReviewStatus(aiItem.id, 'resolved', 'confirmed')
  assert.equal(confirmed.writingReviewQueue.find((item) => item.id === aiItem.id)?.decision, 'confirmed')
  assert.equal(confirmed.drafts[0].findings.some((finding) => finding.replacement === 'No one'), true)
  assert.equal(confirmed.drafts[0].reviewStatus, 'practice')

  const savedAgain = store.saveState(confirmed)
  assert.equal(savedAgain.writingReviewQueue.some((item) => item.source === 'ai'), true)
  assert.equal(savedAgain.writingReviewQueue.find((item) => item.id === aiItem.id)?.decision, 'confirmed')
  store.close()
})

test('a parent-approved deletion survives saving and reopening the draft', () => {
  const store = createStore(':memory:')
  try {
    const state = sampleState()
    state.activeTimer = null
    state.drafts[0].body = 'She saw the the bird.'
    state.drafts[0].reviewSuggestions = [{
      id: 'delete-duplicate', category: 'Grammar', source: 'ai', message: 'Remove the extra word.',
      excerpt: state.drafts[0].body, start: 12, end: 16, replacement: '',
    }]
    const saved = store.saveState(state)
    const review = saved.writingReviewQueue.find((item) => item.id.endsWith('delete-duplicate'))
    assert.equal(review.replacement, '')
    const confirmed = store.setWritingReviewStatus(review.id, 'resolved', 'confirmed', '')
    const finding = confirmed.drafts[0].findings.find((item) => item.replacement === '')
    assert.ok(finding)
    confirmed.drafts[0].exerciseProgress[finding.id] = { correctionComplete: true, practiceCompleted: finding.practice.length, incorrectAttempts: 0 }
    store.saveState(confirmed)
    assert.equal(store.loadState().drafts[0].correctedBody, 'She saw the bird.')
  } finally {
    store.close()
  }
})

test('an incomplete proofreading review prevents a clean-looking draft from being completed', () => {
  const store = createStore(':memory:')
  try {
    const state = sampleState()
    state.activeTimer = null
    state.drafts[0].body = 'The dog ran home.'
    state.drafts[0].reviewSuggestions = [{ id: 'incomplete-proofreading', source: 'local', category: 'Grammar', message: 'Recheck this version.', excerpt: state.drafts[0].body }]
    assert.equal(store.saveState(state).drafts[0].reviewStatus, 'awaiting-review')
    assert.equal(store.loadState().drafts[0].reviewStatus, 'awaiting-review')
  } finally {
    store.close()
  }
})

test('a persisted blank writing workspace remains a draft and preserves earlier versions', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.activeTimer = null
  state.drafts.unshift({
    id: 'fresh-draft',
    weekId: '2026-09-28',
    activityKey: '2026-09-28:Sunday',
    revisionGroupId: 'fresh-draft',
    versionNumber: 1,
    title: '',
    body: '',
    correctedBody: '',
    updatedAt: '2026-10-04T08:00:00.000Z',
    findings: [],
    proofreadingMatches: [],
    reviewSuggestions: [],
    exerciseProgress: {},
    spellingWords: [],
    spellingProgress: {},
    reviewStatus: 'draft',
  })

  const saved = store.saveState(state)
  assert.equal(saved.drafts.length, 2)
  assert.equal(saved.drafts[0].id, 'fresh-draft')
  assert.equal(saved.drafts[0].activityKey, '2026-09-28:Sunday')
  assert.equal(saved.drafts[0].body, '')
  assert.equal(saved.drafts[0].reviewStatus, 'draft')
  assert.equal(saved.drafts[1].id, 'draft-1')
  assert.equal(saved.drafts[1].body, 'Today I receive a persistence test.')
  store.close()
})

test('sentence meaning review survives persistence and blocks the correction quiz until selected', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.activeTimer = null
  state.drafts[0].sentenceReviews = [{
    id: 'sentence-0-15',
    start: 0,
    end: 15,
    original: 'She walk home.',
    highlights: [{ start: 4, end: 8 }],
    attempt: 1,
    options: [
      { id: 'one', text: 'She walks home.', edits: [] },
      { id: 'two', text: 'She walked home.', edits: [] },
      { id: 'three', text: 'She will walk home.', edits: [] },
    ],
  }]

  const pending = store.saveState(state)
  assert.equal(pending.drafts[0].reviewStatus, 'intent-review')
  assert.equal(pending.drafts[0].sentenceReviews[0].options.length, 3)

  pending.drafts[0].sentenceReviews[0].selectedOptionId = 'one'
  pending.drafts[0].sentenceReviews[0].selectedText = 'She walks home.'
  const selected = store.saveState(pending)
  assert.notEqual(selected.drafts[0].reviewStatus, 'intent-review')
  assert.equal(selected.drafts[0].sentenceReviews[0].selectedOptionId, 'one')
  store.close()
})

test('unverified local proofreading candidates persist but never become child findings', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.drafts[0] = {
    ...state.drafts[0],
    body: 'A qwick fox arrived.',
    correctedBody: 'A qwick fox arrived.',
    proofreadingMatches: [{
      offset: 2,
      length: 5,
      message: 'Possible spelling mistake found.',
      shortMessage: '',
      replacements: ['quick', 'quirk'],
      ruleId: 'MORFOLOGIK_RULE_EN_US',
      category: 'Possible Typo',
      issueType: 'misspelling',
      source: 'languagetool',
      verification: 'candidate',
    }],
    findings: [],
    exerciseProgress: {},
    reviewStatus: 'complete',
  }

  const saved = store.saveState(state)
  assert.deepEqual(saved.drafts[0].proofreadingMatches.map((match) => match.replacements), [['quick', 'quirk']])
  assert.equal(saved.drafts[0].findings.find((finding) => finding.start === 2), undefined)
  assert.equal(saved.drafts[0].reviewStatus, 'complete')
  store.close()
})

test('unfinished five-example writing drafts migrate to three examples without losing completed responses', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-writing-target-'))
  const filename = join(directory, 'homework.sqlite')
  try {
    const first = createStore(filename)
    const state = sampleState()
    const body = 'She play games.'
    const finding = inspectDraft(body)[0]
    const legacyFinding = {
      ...finding,
      practice: [...finding.practice, finding.practice[0], finding.practice[1]],
    }
    state.drafts = [{
      id: 'legacy-writing-draft',
      title: 'Legacy writing practice',
      body,
      correctedBody: 'She plays games.',
      findings: [legacyFinding],
      exerciseProgress: {
        [finding.id]: {
          correctionComplete: true,
          practiceCompleted: 5,
          incorrectAttempts: 3,
          attemptResults: [false, true, false, true, false, true],
        },
      },
      spellingWords: [],
      spellingProgress: {},
      reviewStatus: 'practice',
      updatedAt: '2026-10-03T16:00:00.000Z',
    }]
    first.saveState(state)
    first.db.prepare(`
      UPDATE writing_submission
      SET findings_json = ?, exercise_progress_json = ?, review_status = 'practice'
      WHERE id = 'legacy-writing-draft'
    `).run(
      JSON.stringify([legacyFinding]),
      JSON.stringify(state.drafts[0].exerciseProgress),
    )
    first.db.prepare(`DELETE FROM app_meta WHERE key = 'writing_practice_target_3_migrated'`).run()
    first.close()

    const reopened = createStore(filename)
    const migrated = reopened.loadState().drafts[0]
    assert.equal(migrated.findings[0].practice.length, 3)
    assert.equal(migrated.exerciseProgress[finding.id].practiceCompleted, 3)
    assert.deepEqual(
      migrated.exerciseProgress[finding.id].attemptResults,
      [false, true, false, true],
    )
    assert.equal(migrated.reviewStatus, 'complete')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('unfinished repeated-rule findings migrate to different reviewed question sets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-varied-practice-'))
  const filename = join(directory, 'homework.sqlite')
  try {
    const first = createStore(filename)
    const body = 'She play games. He walk home. It run fast.'
    const findings = inspectDraft(body)
      .filter((finding) => finding.ruleId === 'subject-verb-singular')
    const legacyFindings = findings.map((finding) => ({
      ...finding,
      practice: findings[0].practice.map((trial) => ({ ...trial, choices: [...trial.choices] })),
    }))
    const state = sampleState()
    state.drafts = [{
      id: 'repeated-rule-draft',
      title: 'Repeated rule',
      body,
      correctedBody: body,
      findings: legacyFindings,
      exerciseProgress: {},
      spellingWords: [],
      spellingProgress: {},
      reviewStatus: 'practice',
      updatedAt: '2026-10-03T16:00:00.000Z',
    }]
    first.saveState(state)
    first.db.prepare(`
      UPDATE writing_submission
      SET findings_json = ?, review_status = 'practice'
      WHERE id = 'repeated-rule-draft'
    `).run(JSON.stringify(legacyFindings))
    first.db.prepare(`DELETE FROM app_meta WHERE key = 'varied_writing_practice_v2_migrated'`).run()
    first.close()

    const reopened = createStore(filename)
    const migrated = reopened.loadState().drafts[0].findings
      .filter((finding) => finding.ruleId === 'subject-verb-singular')
    assert.deepEqual(
      migrated.map((finding) => finding.practice.map((trial) => trial.id)),
      [
        ['subject-verb-singular-1', 'subject-verb-singular-2', 'subject-verb-singular-3'],
        ['subject-verb-singular-4', 'subject-verb-singular-5', 'subject-verb-singular-6'],
        ['subject-verb-singular-7', 'subject-verb-singular-8', 'subject-verb-singular-9'],
      ],
    )
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a pending writing session re-analyzes a legacy completed draft for multiple-choice spelling', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-spelling-choice-'))
  const filename = join(directory, 'homework.sqlite')
  const clock = controlledClock()
  try {
    const first = createStore(filename, clock.options())
    first.startGameSession({
      activityId: 'reading-strategies',
      day: 'Monday',
      expectedOrigin: 'http://127.0.0.1:4179',
    })
    clock.advance(1_000)
    const body = 'the hambester runs and he was happy.'
    const legacyFindings = inspectDraft(body)
    const state = sampleState()
    state.drafts = [{
      id: 'active-legacy-draft',
      title: 'Active legacy draft',
      body,
      correctedBody: body,
      findings: legacyFindings,
      exerciseProgress: Object.fromEntries(legacyFindings.map((finding) => [finding.id, {
        correctionComplete: true,
        practiceCompleted: finding.practice.length,
        incorrectAttempts: 0,
        attemptResults: Array.from({ length: finding.practice.length + 1 }, () => true),
      }])),
      spellingWords: [],
      spellingProgress: {},
      reviewStatus: 'complete',
      updatedAt: '2026-10-03T16:00:01.000Z',
    }]
    first.saveState(state)
    first.db.prepare(`
      UPDATE writing_submission
      SET findings_json = ?, exercise_progress_json = ?, review_status = 'complete'
      WHERE id = 'active-legacy-draft'
    `).run(JSON.stringify(legacyFindings), JSON.stringify(state.drafts[0].exerciseProgress))
    first.db.prepare(`DELETE FROM app_meta WHERE key = 'spelling_multiple_choice_v2_migrated'`).run()
    first.close()

    const reopened = createStore(filename, clock.options())
    const migrated = reopened.loadState().drafts[0]
    assert.equal(migrated.findings.some((finding) => finding.category === 'Spelling'), true)
    assert.equal(migrated.findings.find((finding) => finding.category === 'Spelling').replacement, 'hamster')
    assert.equal(migrated.reviewStatus, 'practice')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('protected service mode keeps the SQLite database owner-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-protected-db-'))
  const filename = join(directory, 'homework.sqlite')
  try {
    const store = createStore(filename, { enforceFilePermissions: true })
    assert.equal(statSync(filename).mode & 0o777, 0o600)
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('routine browser saves cannot change parent-owned records after migration', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const initial = sampleState()
  initial.activeTimer = null
  initial.drafts[0].body = 'I saw the the sign.'
  initial.writingReviewQueue = [{
    id: 'draft-1:repeated-word-6',
    draftId: 'draft-1',
    category: 'Grammar',
    message: 'A word may repeat.',
    excerpt: 'I saw the the sign.',
    status: 'pending',
    createdAt: '2026-10-03T07:00:00.000Z',
  }]
  const imported = store.saveState(initial)
  const spoofed = structuredClone(imported)
  spoofed.requiredByDay.Monday.push('reading-strategies', 'ninja-dojo')
  spoofed.optionalCompleted.push('du-chinese:1')
  spoofed.rewardCredits.push({
    id: 'spoofed-credit',
    source: 'Browser',
    remainingSeconds: 3600,
    earnedAt: '2026-10-03T16:00:00.000Z',
  })
  spoofed.writingDictionary.knownNames.push('Spoofed Name')
  spoofed.writingReviewQueue[0].status = 'resolved'
  spoofed.entered = false

  const saved = store.saveState(spoofed)
  assert.deepEqual(saved.requiredByDay.Monday, ['mandarin', 'math'])
  assert.deepEqual(saved.optionalCompleted, ['voena:0'])
  assert.equal(saved.rewardCredits.some((credit) => credit.id === 'spoofed-credit'), false)
  assert.equal(saved.writingDictionary.knownNames.includes('Spoofed Name'), false)
  assert.equal(saved.writingReviewQueue[0].status, 'pending')
  assert.equal(saved.entered, true)

  const credited = store.addParentRewardCredit({ seconds: 300 })
  assert.equal(credited.rewardCredits.length, 2)
  store.close()
})

test('child entry creates one persistent restrictive guardian lifecycle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-lifecycle-'))
  const filename = join(directory, 'homework.sqlite')
  const clock = controlledClock('2026-10-05T16:00:00.000Z')

  try {
    const first = createStore(filename, clock.options())
    assert.deepEqual(first.getGuardianLifecycle().mode, 'inactive')
    const started = first.startLearningSession()
    assert.equal(started.mode, 'homework')
    assert.equal(started.session.weekId, '2026-10-05')
    assert.equal(started.session.day, 'Monday')
    assert.match(started.session.serviceSessionId, /^[0-9a-f-]{36}$/i)
    assert.equal(started.session.completionProof, null)
    assert.equal(first.startLearningSession().session.serviceSessionId, started.session.serviceSessionId)
    assert.equal(first.loadState().entered, true)
    assert.equal(
      first.db.prepare('SELECT count(*) AS count FROM guardian_learning_session').get().count,
      1,
    )
    first.close()

    const reopened = createStore(filename, clock.options('reopened-runtime'))
    assert.equal(reopened.getGuardianLifecycle().session.serviceSessionId, started.session.serviceSessionId)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('verified completion proof unlocks free mode and a correction rotates the lifecycle', () => {
  const clock = controlledClock('2026-10-05T16:00:00.000Z')
  const store = createStore(':memory:', clock.options())
  const started = store.startLearningSession()
  const weekId = started.session.weekId

  for (const activityId of [
    'mandarin', 'level-chinese', 'du-chinese', 'math', 'english-packet',
    'reading-strategies', 'ninja-dojo',
  ]) {
    store.setDailyCompletion({
      day: 'Monday',
      activityId,
      completed: true,
      method: 'parent-override',
      weekId,
    })
  }
  for (const sessionKey of ['voena:0', 'drums:0']) {
    store.db.prepare(`
      INSERT INTO weekly_optional_completion (week_id, session_key, completed_at)
      VALUES (?, ?, ?)
    `).run(weekId, sessionKey, '2026-10-05T16:05:00.000Z')
  }

  const free = store.getGuardianLifecycle()
  assert.equal(free.mode, 'free')
  assert.equal(free.session.serviceSessionId, started.session.serviceSessionId)
  assert.deepEqual(free.session.completionProof, {
    serviceSessionId: started.session.serviceSessionId,
    weekId,
    day: 'Monday',
    eligibleAt: free.session.completionProof.eligibleAt,
    requiredCompleted: 7,
    requiredTarget: 7,
    optionalCompleted: 2,
    optionalTarget: 2,
  })

  store.setDailyCompletion({
    day: 'Monday',
    activityId: 'math',
    completed: false,
    method: 'parent-override',
    weekId,
  })
  const relocked = store.getGuardianLifecycle()
  assert.equal(relocked.mode, 'homework')
  assert.notEqual(relocked.session.serviceSessionId, started.session.serviceSessionId)
  assert.equal(relocked.session.completionProof, null)
  assert.equal(
    store.db.prepare(`
      SELECT status FROM guardian_learning_session WHERE service_session_id = ?
    `).get(started.session.serviceSessionId).status,
    'superseded',
  )
  store.close()
})

function controlledClock(start = '2026-10-03T16:00:00.000Z') {
  let wallMs = Date.parse(start)
  let monotonicMs = 0
  let id = 0
  let nonce = 0
  return {
    options(runtimeId = 'test-runtime') {
      return {
        runtimeId,
        wallNow: () => new Date(wallMs),
        monotonicNow: () => monotonicMs,
        makeId: () => `test-id-${++id}`,
        makeNonce: () => `test-game-nonce-${++nonce}-secure-value`,
      }
    },
    advance(milliseconds) {
      wallMs += milliseconds
      monotonicMs += milliseconds
    },
    setWall(value) {
      wallMs = Date.parse(value)
    },
  }
}

test('heartbeats award only bounded active monotonic time', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())

  const session = store.startSession({
    kind: 'required',
    activityId: 'ninja-dojo',
    sessionKey: 'Monday',
    label: 'Ninja Dojo',
    targetSeconds: 10,
  })

  clock.advance(5_000)
  const first = store.heartbeatSession(session.id, true)
  assert.equal(first.creditedSeconds, 5)
  assert.equal(first.remainingSeconds, 5)

  clock.advance(9_000)
  const afterLongGap = store.heartbeatSession(session.id, true)
  assert.equal(afterLongGap.creditedSeconds, 5, 'a delayed heartbeat must not award offline time')

  clock.advance(5_000)
  const completed = store.heartbeatSession(session.id, true)
  assert.equal(completed.status, 'completed')
  assert.equal(store.loadState().requiredByDay.Monday.includes('ninja-dojo'), true)
  store.close()
})

test('paused and hidden intervals earn no session credit', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'required',
    activityId: 'ninja-dojo',
    sessionKey: 'Friday',
    label: 'Ninja Dojo',
    targetSeconds: 10,
  })

  clock.advance(3_000)
  assert.equal(store.heartbeatSession(session.id, false).creditedSeconds, 0)
  clock.advance(60_000)
  assert.equal(store.heartbeatSession(session.id, false).creditedSeconds, 0)
  store.heartbeatSession(session.id, true)
  clock.advance(5_000)
  assert.equal(store.heartbeatSession(session.id, true).creditedSeconds, 5)
  store.close()
})

test('repeated completion heartbeats cannot duplicate optional credit or rewards', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'optional',
    activityId: 'voena',
    sessionKey: 'voena:0',
    label: 'Voena · Session 1',
    targetSeconds: 5,
  })

  clock.advance(5_000)
  store.heartbeatSession(session.id, true)
  store.heartbeatSession(session.id, true)

  const state = store.loadState()
  assert.deepEqual(state.optionalCompleted, ['voena:0'])
  assert.equal(state.rewardCredits.length, 1)
  assert.equal(state.completionRecords.filter((record) => record.id === `session:${session.id}`).length, 1)
  store.close()
})

test('YouTube rewards count only managed foreground content playback', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.saveState({
    ...sampleState(),
    activeTimer: null,
    rewardCredits: [{ ...sampleState().rewardCredits[0], remainingSeconds: 10 }],
  })
  const session = store.startSession({
    kind: 'reward',
    activityId: 'credit-1',
    label: 'YouTube reward',
    targetSeconds: 10,
    selectionSeconds: 120,
    plan: {
      phases: [{
        id: 'youtube-playback',
        label: 'YouTube playback',
        targetSeconds: 10,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: ['https://www.youtube.com'],
        creditOrigins: ['https://www.youtube.com'],
        verification: 'youtube-playback',
      }],
    },
  })
  const chromeHeartbeat = (playbackActive) => store.recordChromeExtensionHeartbeat({
    extensionId: 'managed-extension',
    version: '0.1.0',
    mode: 'homework',
    activeOrigin: 'https://www.youtube.com',
    decision: 'allowed',
    policyVersion: '3',
    playbackActive,
  })

  assert.equal(session.status, 'paused')
  assert.equal(session.managedChromeRequired, true)
  clock.advance(5_000)
  assert.equal(store.heartbeatSession(session.id, true).creditedSeconds, 0, 'browser focus is not playback proof')
  chromeHeartbeat(false)
  clock.advance(5_000)
  chromeHeartbeat(false)
  assert.equal(store.loadState().activeTimer.creditedSeconds, 0, 'paused, buffered, and ad time must not count')

  chromeHeartbeat(true)
  assert.equal(store.loadState().activeTimer.rewardPlaybackStarted, true)
  clock.advance(5_000)
  chromeHeartbeat(true)
  assert.equal(store.loadState().activeTimer.creditedSeconds, 5)

  clock.advance(5_000)
  chromeHeartbeat(false)
  assert.equal(store.loadState().activeTimer.creditedSeconds, 5)
  store.cancelSession(session.id)
  assert.equal(store.loadState().rewardCredits[0].remainingSeconds, 5)

  const resumed = store.startSession({
    kind: 'reward',
    activityId: 'credit-1',
    label: 'YouTube reward',
    targetSeconds: 5,
    selectionSeconds: 120,
    plan: {
      phases: [{
        id: 'youtube-playback',
        label: 'YouTube playback',
        targetSeconds: 5,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: ['https://www.youtube.com'],
        creditOrigins: ['https://www.youtube.com'],
        verification: 'youtube-playback',
      }],
    },
  })
  chromeHeartbeat(true)
  clock.advance(5_000)
  chromeHeartbeat(true)
  assert.equal(store.loadState().activeTimer.status, 'completed')
  assert.equal(store.loadState().rewardCredits.length, 0)
  assert.equal(
    store.loadState().completionRecords.find((record) => record.id === `session:${resumed.id}`).method,
    'reward-playback',
  )
  store.close()
})

test('an unused YouTube selection window expires without spending its credit', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.saveState({ ...sampleState(), activeTimer: null })
  const session = store.startSession({
    kind: 'reward',
    activityId: 'credit-1',
    label: 'YouTube reward',
    targetSeconds: 300,
    selectionSeconds: 120,
    plan: {
      phases: [{
        id: 'youtube-playback',
        label: 'YouTube playback',
        targetSeconds: 300,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: ['https://www.youtube.com'],
        creditOrigins: ['https://www.youtube.com'],
        verification: 'youtube-playback',
      }],
    },
  })

  clock.advance(120_001)
  assert.equal(store.heartbeatSession(session.id, false), null)
  assert.equal(store.loadState().activeTimer, null)
  assert.equal(store.loadState().rewardCredits[0].remainingSeconds, 300)
  assert.equal(store.listAudit()[0].eventType, 'reward_selection_expired')
  store.close()
})

test('a service restart recovers an incomplete session paused without adding downtime', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-session-recovery-'))
  const filename = join(directory, 'homework.sqlite')
  const clock = controlledClock()

  try {
    const first = createStore(filename, clock.options('runtime-one'))
    const session = first.startSession({
      kind: 'required',
      activityId: 'ninja-dojo',
      sessionKey: 'Tuesday',
      label: 'Ninja Dojo',
      targetSeconds: 20,
    })
    clock.advance(5_000)
    first.heartbeatSession(session.id, true)
    first.close()

    clock.advance(60_000)
    const reopened = createStore(filename, clock.options('runtime-two'))
    const recovered = reopened.loadState().activeTimer
    assert.equal(recovered.status, 'paused')
    assert.equal(recovered.remainingSeconds, 15)

    reopened.heartbeatSession(session.id, true)
    assert.equal(reopened.loadState().activeTimer.remainingSeconds, 15)
    clock.advance(5_000)
    assert.equal(reopened.heartbeatSession(session.id, true).remainingSeconds, 10)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('managed Du Chinese phases reject browser credit and survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-du-phases-'))
  const filename = join(directory, 'homework.sqlite')
  const clock = controlledClock()
  const plan = {
    phases: [
      {
        id: 'reading',
        label: 'Reading',
        targetSeconds: 5,
        launchUrl: 'https://read.example/story',
        allowedOrigins: ['https://read.example', 'https://cards.example'],
        creditOrigins: ['https://read.example'],
        verification: 'managed-chrome',
      },
      {
        id: 'flashcards',
        label: 'Flashcards',
        targetSeconds: 5,
        launchUrl: 'https://cards.example/review',
        allowedOrigins: ['https://read.example', 'https://cards.example'],
        creditOrigins: ['https://cards.example'],
        verification: 'managed-chrome',
        navigateOnStart: true,
      },
    ],
  }

  try {
    const first = createStore(filename, clock.options('du-runtime-one'))
    const session = first.startSession({
      kind: 'required',
      activityId: 'du-chinese',
      sessionKey: 'Monday',
      label: 'Du Chinese',
      targetSeconds: 10,
      plan,
    })
    assert.equal(session.status, 'paused')
    assert.equal(session.phaseId, 'reading')
    assert.equal(session.managedChromeRequired, true)

    clock.advance(5_000)
    assert.equal(first.heartbeatSession(session.id, true).creditedSeconds, 0)
    first.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://read.example',
    })
    clock.advance(5_000)
    const flashcards = first.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://read.example',
    })
    assert.equal(flashcards.phaseId, 'flashcards')
    assert.equal(flashcards.creditedSeconds, 5)
    assert.equal(flashcards.status, 'paused')
    first.close()

    const reopened = createStore(filename, clock.options('du-runtime-two'))
    assert.equal(reopened.loadState().activeTimer.phaseId, 'flashcards')
    reopened.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://read.example',
    })
    assert.equal(reopened.loadState().activeTimer.creditedSeconds, 5)
    reopened.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://cards.example',
    })
    clock.advance(5_000)
    const completed = reopened.heartbeatSession(session.id, true, {
      source: 'managed-chrome',
      activeOrigin: 'https://cards.example',
    })
    assert.equal(completed.status, 'completed')
    assert.equal(reopened.loadState().requiredByDay.Monday.includes('du-chinese'), true)
    assert.equal(reopened.loadState().optionalCompleted.length, 0)
    assert.equal(reopened.loadState().rewardCredits.length, 0)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Level Chinese waits for an exact managed-Chrome learning origin', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'required',
    activityId: 'level-chinese',
    sessionKey: 'Tuesday',
    label: 'Level Chinese',
    targetSeconds: 5,
    plan: {
      phases: [
        {
          id: 'clever-login',
          label: 'Log in through Clever',
          targetSeconds: 0,
          launchUrl: 'https://clever.example/login',
          allowedOrigins: ['https://clever.example', 'https://level.example'],
          creditOrigins: [],
          advanceOrigins: ['https://level.example'],
          verification: 'managed-chrome',
        },
        {
          id: 'level-learning',
          label: 'Level Learning',
          targetSeconds: 5,
          launchUrl: 'https://level.example/learn',
          allowedOrigins: ['https://clever.example', 'https://level.example'],
          creditOrigins: ['https://level.example'],
          verification: 'managed-chrome',
        },
      ],
    },
  })

  const heartbeat = (activeOrigin) => store.recordChromeExtensionHeartbeat({
    extensionId: 'managed-extension',
    version: '0.1.0',
    mode: 'homework',
    activeOrigin,
    decision: 'allowed',
    policyVersion: '2',
  })

  heartbeat('https://clever.example')
  assert.equal(store.loadState().activeTimer.phaseId, 'clever-login')
  heartbeat('https://level.example.evil.test')
  assert.equal(store.loadState().activeTimer.phaseId, 'clever-login')
  heartbeat('https://level.example')
  assert.equal(store.loadState().activeTimer.phaseId, 'level-learning')
  clock.advance(5_000)
  heartbeat('https://level.example')
  assert.equal(store.loadState().activeTimer.status, 'completed')
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'session_phase_advanced').length,
    1,
  )
  assert.equal(session.phaseId, 'clever-login')
  assert.equal(store.loadState().requiredByDay.Tuesday.includes('level-chinese'), true)
  store.close()
})

test('parent activity configuration persists with readiness and an audit event', () => {
  const store = createStore(':memory:')
  const saved = store.setActivityConfiguration({
    ninjaDojo: { launchUrl: 'https://hub.example.edu/grade-5', allowedOrigins: [] },
    duChinese: { readingUrl: '', flashcardUrl: '', allowedOrigins: [] },
    levelChinese: { cleverUrl: '', learningUrl: '', allowedOrigins: [] },
  })

  assert.equal(saved.ninjaDojo.ready, true)
  assert.equal(store.loadState().activityConfiguration.ninjaDojo.launchUrl, 'https://hub.example.edu/grade-5')
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'activity_configuration_updated').length,
    1,
  )
  store.close()
})

test('completion records identify self reports without duplicating repeated requests', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())

  store.setDailyCompletion({
    day: 'Wednesday',
    activityId: 'math',
    completed: true,
    method: 'self-reported',
  })
  store.setDailyCompletion({
    day: 'Wednesday',
    activityId: 'math',
    completed: true,
    method: 'self-reported',
  })

  const state = store.loadState()
  assert.deepEqual(state.requiredByDay.Wednesday, ['math'])
  assert.equal(state.completionRecords.length, 1)
  assert.equal(state.completionRecords[0].method, 'self-reported')
  store.close()
})

test('guardian heartbeats expire instead of leaving a false connected state', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())

  const current = store.recordGuardianHeartbeat({
    guardianId: 'child-mac',
    mode: 'dry-run',
    activeBundleId: 'com.google.Chrome',
    decision: 'allowed',
    version: '0.1.0',
  })
  assert.equal(current.connected, true)
  assert.equal(store.loadState().guardianConnected, true)

  const blockedHeartbeat = {
    guardianId: 'child-mac',
    mode: 'dry-run',
    activeBundleId: 'com.apple.Terminal',
    decision: 'blocked',
    version: '0.1.0',
  }
  store.recordGuardianHeartbeat(blockedHeartbeat)
  store.recordGuardianHeartbeat(blockedHeartbeat)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'guardian_blocked_app_observed').length,
    1,
  )

  clock.advance(16_000)
  assert.equal(store.getGuardianStatus().connected, false)
  assert.equal(store.loadState().guardianConnected, false)
  store.close()
})

test('Chrome extension heartbeats expire and deduplicate blocked-navigation audits', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const heartbeat = {
    extensionId: 'mmpeglplfjkbefdgikaldkncikpfdend',
    version: '0.1.0',
    mode: 'homework',
    activeOrigin: 'https://example.com',
    decision: 'blocked',
    policyVersion: '1',
  }

  store.recordChromeExtensionHeartbeat(heartbeat)
  store.recordChromeExtensionHeartbeat(heartbeat)
  assert.equal(store.getChromeExtensionStatus().connected, true)
  assert.equal(store.loadState().chromeConnected, true)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'chrome_navigation_blocked').length,
    1,
  )

  clock.advance(46_000)
  assert.equal(store.getChromeExtensionStatus().connected, false)
  assert.equal(store.loadState().chromeConnected, false)
  store.close()
})

function assertServiceError(callback, status, code) {
  assert.throws(callback, (error) => {
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

test('a valid one-time game token atomically records verified Reading Strategies completion', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const { session, nonce } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Monday',
    expectedOrigin: origin,
    ttlSeconds: 60,
  })

  const stored = store.db.prepare('SELECT nonce_hash FROM game_session WHERE id = ?').get(session.id)
  assert.notEqual(stored.nonce_hash, nonce)
  assert.equal(stored.nonce_hash.includes(nonce), false)
  assert.equal(store.loadState().activeGameSession.id, session.id)

  const completed = store.completeGameSession({ id: session.id, nonce, origin })
  assert.equal(completed.status, 'completed')
  const state = store.loadState()
  assert.equal(state.activeGameSession, null)
  assert.equal(state.requiredByDay.Monday.includes('reading-strategies'), true)
  assert.equal(state.completionRecords[0].method, 'game-verified')
  assert.equal(state.completionRecords[0].source, 'reading-game-contract')
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'game_session_completed').length,
    1,
  )
  store.close()
})

test('writing remediation requires practice, a saved revision, and a clean final check', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const { session } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Monday',
    expectedOrigin: 'http://127.0.0.1:4179',
  })
  assert.equal(new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime(), 24 * 60 * 60 * 1000)
  const body = 'She play games.'
  const finding = inspectDraft(body)[0]
  const state = sampleState()
  state.activeTimer = null
  state.drafts = [{
    id: 'writing-game-draft',
    revisionGroupId: 'writing-game-draft',
    versionNumber: 1,
    title: 'My reading response',
    body,
    correctedBody: 'She plays games.',
    updatedAt: '2026-10-03T16:00:01.000Z',
    findings: [finding],
    exerciseProgress: {
      [finding.id]: {
        correctionComplete: true,
        practiceCompleted: 2,
        incorrectAttempts: 3,
        attemptResults: [false, false, false],
      },
    },
    spellingWords: [],
    spellingProgress: {},
    reviewStatus: 'practice',
  }]
  clock.advance(1_000)
  store.saveState(state)

  assertServiceError(
    () => store.completeWritingGameSession({ id: session.id, draftId: 'writing-game-draft' }),
    409,
    'writing_practice_incomplete',
  )

  state.drafts[0].exerciseProgress[finding.id] = {
    correctionComplete: true,
    practiceCompleted: 3,
    incorrectAttempts: 4,
    attemptResults: [false, false, false, false],
  }
  state.drafts[0].updatedAt = '2026-10-03T16:00:02.000Z'
  clock.advance(1_000)
  store.saveState(state)
  assertServiceError(
    () => store.completeWritingGameSession({ id: session.id, draftId: 'writing-game-draft' }),
    409,
    'writing_revision_required',
  )

  state.drafts.unshift({
    id: 'writing-game-revision',
    revisionGroupId: 'writing-game-draft',
    versionNumber: 2,
    title: 'My reading response',
    body: 'She plays games.',
    correctedBody: 'She plays games.',
    updatedAt: '2026-10-03T16:00:03.000Z',
    findings: [],
    exerciseProgress: {},
    spellingWords: [],
    spellingProgress: {},
    reviewStatus: 'complete',
  })
  clock.advance(1_000)
  store.saveState(state)
  const completed = store.completeWritingGameSession({ id: session.id, draftId: 'writing-game-revision' })

  assert.equal(completed.evidence.correct, 0)
  assert.equal(completed.evidence.total, 4)
  assert.equal(completed.evidence.percent, 0)
  assert.equal(completed.evidence.edited, true)
  assert.equal(completed.evidence.versionCount, 2)
  assert.equal(completed.evidence.findingCount, 1)
  assert.equal(store.loadState().requiredByDay.Monday.includes('reading-strategies'), true)
  assert.equal(store.listCompletions()[0].source, 'writing-remediation')
  store.close()
})

test('game completion rejects spoofed origins and tokens without awarding credit', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const { session, nonce } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Tuesday',
    expectedOrigin: origin,
  })

  assertServiceError(
    () => store.completeGameSession({ id: session.id, nonce, origin: 'https://attacker.example' }),
    403,
    'origin_mismatch',
  )
  assertServiceError(
    () => store.completeGameSession({ id: session.id, nonce: 'wrong-token', origin }),
    403,
    'nonce_mismatch',
  )
  assert.deepEqual(store.loadState().requiredByDay.Tuesday, [])
  assert.equal(store.listCompletions().length, 0)
  store.close()
})

test('a completed game token cannot be replayed', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const { session, nonce } = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Wednesday',
    expectedOrigin: origin,
  })

  store.completeGameSession({ id: session.id, nonce, origin })
  assertServiceError(
    () => store.completeGameSession({ id: session.id, nonce, origin }),
    409,
    'session_replayed',
  )
  assert.equal(store.listCompletions().filter((record) => record.method === 'game-verified').length, 1)
  store.close()
})

test('expired and replaced game sessions cannot award completion', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  const origin = 'https://reading.example'
  const expired = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Thursday',
    expectedOrigin: origin,
    ttlSeconds: 1,
  })
  clock.advance(1_001)
  assertServiceError(
    () => store.completeGameSession({ id: expired.session.id, nonce: expired.nonce, origin }),
    410,
    'session_expired',
  )

  const first = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Friday',
    expectedOrigin: origin,
  })
  const replacement = store.startGameSession({
    activityId: 'reading-strategies',
    day: 'Friday',
    expectedOrigin: origin,
  })
  assert.equal(store.getGameSession(first.session.id).status, 'cancelled')
  assert.equal(store.getGameSession(replacement.session.id).status, 'pending')
  assertServiceError(
    () => store.completeGameSession({ id: first.session.id, nonce: first.nonce, origin }),
    409,
    'session_inactive',
  )
  store.close()
})

test('browser state import cannot spoof a verified or timed required completion', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.requiredByDay.Monday.push('reading-strategies', 'ninja-dojo')
  const saved = store.saveState(state)

  assert.deepEqual(saved.requiredByDay.Monday, ['mandarin', 'math'])
  assert.equal(saved.completionRecords.some((record) => record.activityId === 'reading-strategies'), false)
  assert.equal(saved.completionRecords.some((record) => record.activityId === 'ninja-dojo'), false)
  store.close()
})

test('mock Google delivery is persistent and duplicate-safe for a weekly document', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.saveState(sampleState())

  const connected = store.connectMockGoogle({ accountEmail: 'Parent.Test@example.com' })
  assert.equal(connected.connected, true)
  assert.equal(connected.accountEmail, 'parent.test@example.com')

  const prepared = store.prepareMockGoogleDelivery({
    recipient: 'Teacher.Test@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(prepared.created, true)
  assert.equal(prepared.delivery.status, 'creating')
  assert.equal(prepared.delivery.draftCount, 1)
  assert.equal(prepared.drafts[0].readingDate, '2026-10-03')
  assert.equal(prepared.drafts[0].title, 'A test draft')
  assert.equal(prepared.drafts[0].author, 'Ursula K. Le Guin')
  assert.equal(prepared.drafts[0].pagesRead, '34–52')

  const completed = store.completeMockGoogleDelivery(prepared.delivery.id, {
    documentPath: '/tmp/mock-google-proof.html',
    pdfPath: '/tmp/mock-google-proof.pdf',
  })
  assert.equal(completed.status, 'simulated')
  assert.match(completed.documentUrl, /\/document$/)
  assert.match(completed.pdfUrl, /\/pdf$/)

  const duplicate = store.prepareMockGoogleDelivery({
    recipient: 'different@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.delivery.id, completed.id)
  assert.equal(store.getGoogleProofState().deliveries.length, 1)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'google_mock_delivery_simulated').length,
    1,
  )

  assert.equal(store.disconnectMockGoogle().connected, false)
  assert.equal(store.getGoogleProofState().deliveries.length, 1)
  store.close()
})

test('mock Google proof records a duplicate-safe skip when no writing exists', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', clock.options())
  store.connectMockGoogle({ accountEmail: 'parent@example.com' })

  const skipped = store.prepareMockGoogleDelivery({
    recipient: 'teacher@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(skipped.created, true)
  assert.equal(skipped.delivery.status, 'skipped')
  assert.equal(skipped.delivery.draftCount, 0)

  const duplicate = store.prepareMockGoogleDelivery({
    recipient: 'teacher@example.com',
    weekId: '2026-09-28',
  })
  assert.equal(duplicate.created, false)
  assert.equal(store.getGoogleProofState().deliveries.length, 1)
  store.close()
})

test('the service recomputes writing completion instead of trusting browser status', () => {
  const store = createStore(':memory:')
  const state = sampleState()
  state.drafts[0] = {
    ...state.drafts[0],
    body: 'today i recieve a letter',
    correctedBody: 'A spoofed completed copy.',
    findings: [],
    exerciseProgress: {},
    spellingWords: [],
    spellingProgress: {},
    reviewStatus: 'complete',
  }
  const saved = store.saveState(state)
  const draft = saved.drafts[0]

  assert.equal(draft.reviewStatus, 'practice')
  assert.deepEqual(draft.findings.map((finding) => finding.ruleId), [
    'sentence-capital', 'pronoun-i', 'spelling-reviewed-recieve', 'terminal-punctuation',
  ])
  assert.deepEqual(draft.spellingWords, [])
  assert.equal(draft.correctedBody, draft.body)
  store.close()
})

test('live Google delivery snapshots complete writing and remains duplicate-safe', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', {
    ...clock.options(),
    googleLiveConfiguration: { mode: 'live', clientConfigured: true, keychainAvailable: true },
  })
  const state = sampleState()
  const findings = inspectWritingFindings(state.drafts[0].body, state.writingDictionary)
  state.drafts[0].revisionGroupId = 'weekly-revision-group'
  state.drafts[0].versionNumber = 2
  state.drafts[0].findings = findings
  state.drafts[0].exerciseProgress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
    attemptResults: Array.from({ length: finding.practice.length + 1 }, () => true),
  }]))
  state.drafts[0].reviewStatus = 'complete'
  const firstBody = 'She play games.'
  const firstFindings = inspectWritingFindings(firstBody, state.writingDictionary)
  state.drafts.push({
    id: 'draft-version-1',
    revisionGroupId: 'weekly-revision-group',
    versionNumber: 1,
    title: state.drafts[0].title,
    body: firstBody,
    correctedBody: 'She plays games.',
    findings: firstFindings,
    exerciseProgress: Object.fromEntries(firstFindings.map((finding) => [finding.id, {
      correctionComplete: true,
      practiceCompleted: finding.practice.length,
      incorrectAttempts: 0,
      attemptResults: Array.from({ length: finding.practice.length + 1 }, () => true),
    }])),
    spellingWords: [],
    spellingProgress: {},
    reviewStatus: 'complete',
    updatedAt: '2026-10-02T20:00:00.000Z',
  })
  state.drafts.push({
    ...state.drafts.at(-1),
    id: 'unfinished-revision-group',
    revisionGroupId: 'unfinished-revision-group',
    versionNumber: 1,
    title: 'Not ready to send',
    updatedAt: '2026-10-02T21:00:00.000Z',
  })
  store.saveState(state)
  store.configureLiveGoogle({ recipient: 'Teacher@School.org' })
  store.connectLiveGoogle({
    accountEmail: 'Fionnbar@example.com',
    scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
  })

  const prepared = store.prepareLiveGoogleDelivery({ weekId: '2026-09-28' })
  assert.equal(prepared.created, true)
  assert.equal(prepared.delivery.status, 'queued')
  assert.equal(prepared.delivery.recipient, 'teacher@school.org')
  assert.equal(prepared.drafts.length, 2)
  assert.deepEqual(prepared.drafts.map((draft) => draft.versionNumber), [1, 2])
  assert.equal(prepared.drafts.some((draft) => draft.id === 'unfinished-revision-group'), false)

  const attempt = store.beginLiveGoogleDeliveryAttempt(prepared.delivery.id)
  assert.equal(attempt.delivery.status, 'creating')
  assert.equal(attempt.delivery.attemptCount, 1)
  store.recordLiveGoogleDocument(prepared.delivery.id, {
    documentId: 'google-doc-1',
    documentUrl: 'https://docs.google.com/document/d/google-doc-1/edit',
  })
  store.recordLiveGooglePdf(prepared.delivery.id, '/tmp/fionnbar-live.pdf')
  store.recordLiveGoogleShare(prepared.delivery.id, 'shared')
  const sent = store.completeLiveGoogleDelivery(prepared.delivery.id, { messageId: 'gmail-1' })
  assert.equal(sent.status, 'sent')
  assert.equal(sent.shareStatus, 'shared')
  assert.equal(sent.emailMessageId, 'gmail-1')

  const duplicate = store.prepareLiveGoogleDelivery({
    weekId: '2026-09-28',
    recipient: 'someone-else@school.org',
  })
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.delivery.id, prepared.delivery.id)
  assert.equal(store.getLiveGoogleState().deliveries.length, 1)
  store.close()
})

test('live Google failures receive an exponential retry time and can be manually requeued', () => {
  const clock = controlledClock()
  const store = createStore(':memory:', {
    ...clock.options(),
    googleLiveConfiguration: { mode: 'live', clientConfigured: true, keychainAvailable: true },
  })
  const state = sampleState()
  const findings = inspectWritingFindings(state.drafts[0].body, state.writingDictionary)
  state.drafts[0].findings = findings
  state.drafts[0].exerciseProgress = Object.fromEntries(findings.map((finding) => [finding.id, {
    correctionComplete: true,
    practiceCompleted: finding.practice.length,
    incorrectAttempts: 0,
    attemptResults: Array.from({ length: finding.practice.length + 1 }, () => true),
  }]))
  state.drafts[0].reviewStatus = 'complete'
  store.saveState(state)
  store.connectLiveGoogle({ accountEmail: 'fionnbar@example.com', scopes: [] })
  store.configureLiveGoogle({ recipient: 'teacher@school.org' })

  const prepared = store.prepareLiveGoogleDelivery({ weekId: '2026-09-28' })
  store.beginLiveGoogleDeliveryAttempt(prepared.delivery.id)
  const failed = store.failLiveGoogleDelivery(prepared.delivery.id, new Error('offline'))
  assert.equal(failed.status, 'failed')
  assert.match(failed.lastError, /offline/)
  assert.equal(store.listRetryableLiveGoogleDeliveries().length, 0)

  clock.advance(5 * 60 * 1000)
  assert.equal(store.listRetryableLiveGoogleDeliveries()[0].id, prepared.delivery.id)
  const queued = store.retryLiveGoogleDelivery(prepared.delivery.id)
  assert.equal(queued.status, 'queued')
  store.close()
})

test('weekly context changes at Sunday 4 a.m. in the configured time zone', () => {
  const before = getWeekContext(new Date('2026-10-04T10:59:59.000Z'), 'America/Los_Angeles')
  assert.equal(before.localDay, 'Sunday')
  assert.equal(before.headStart, false)
  assert.equal(before.weekId, '2026-09-28')

  const after = getWeekContext(new Date('2026-10-04T11:00:00.000Z'), 'America/Los_Angeles')
  assert.equal(after.headStart, true)
  assert.equal(after.weekId, '2026-10-05')
  assert.equal(after.fridayId, '2026-10-09')

  const monday = getWeekContext(new Date('2026-10-05T15:00:00.000Z'), 'America/Los_Angeles')
  assert.equal(monday.localDay, 'Monday')
  assert.equal(monday.headStart, false)
  assert.equal(monday.weekId, '2026-10-05')
})

test('six Sunday sessions and three Monday sessions share one bank, then archive once', () => {
  const clock = controlledClock('2026-10-04T11:00:00.000Z')
  const store = createStore(':memory:', clock.options())
  const allSessions = [
    'voena:0', 'voena:1', 'voena:2',
    'drums:0', 'drums:1', 'drums:2',
    'band:0', 'band:1', 'band:2',
  ]

  const sunday = store.loadState()
  assert.equal(sunday.weekContext.headStart, true)
  assert.equal(sunday.weekContext.weekId, '2026-10-05')
  sunday.entered = true
  sunday.optionalCompleted = allSessions.slice(0, 6)
  const sundaySaved = store.saveState(sunday)
  assert.equal(sundaySaved.optionalCompleted.length, 6)

  clock.setWall('2026-10-05T15:00:00.000Z')
  const monday = store.loadState()
  assert.equal(monday.weekContext.weekId, '2026-10-05')
  assert.equal(monday.weekContext.headStart, false)
  assert.equal(monday.optionalCompleted.length, 6)
  for (const sessionKey of allSessions.slice(6)) {
    const session = store.startSession({
      kind: 'optional',
      activityId: sessionKey.split(':')[0],
      sessionKey,
      label: sessionKey,
      targetSeconds: 1,
    })
    clock.advance(1_000)
    store.heartbeatSession(session.id, true)
    store.acknowledgeSession(session.id)
  }
  store.setDailyCompletion({
    day: 'Monday',
    activityId: 'math',
    completed: true,
    method: 'self-reported',
    weekId: monday.weekContext.weekId,
  })
  assert.equal(store.loadState().optionalCompleted.length, 9)

  clock.setWall('2026-10-11T10:59:59.000Z')
  assert.equal(store.loadState().optionalCompleted.length, 9)
  clock.setWall('2026-10-11T11:00:00.000Z')
  const nextWeek = store.loadState()
  assert.equal(nextWeek.weekContext.weekId, '2026-10-12')
  assert.equal(nextWeek.weekContext.headStart, true)
  assert.equal(nextWeek.optionalCompleted.length, 0)
  assert.deepEqual(nextWeek.requiredByDay.Monday, [])
  assert.equal(nextWeek.entered, false)
  assert.equal(
    store.db.prepare('SELECT archived FROM weekly_plan WHERE week_id = ?').get('2026-10-05').archived,
    1,
  )
  assert.equal(
    store.db.prepare('SELECT count(*) AS count FROM weekly_optional_completion WHERE week_id = ?')
      .get('2026-10-05').count,
    9,
  )
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'weekly_plan_rolled_over').length,
    1,
  )

  assertServiceError(() => store.saveState(monday), 409, 'stale_week')

  clock.setWall('2026-10-05T15:00:00.000Z')
  const rollback = store.loadState()
  assert.equal(rollback.weekContext.weekId, '2026-10-12')
  assert.equal(rollback.weekContext.clockRollbackDetected, true)
  assert.equal(rollback.optionalCompleted.length, 0)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'weekly_plan_rolled_over').length,
    1,
  )
  store.close()
})

test('schema 7 migrates existing unscoped completions into the active week once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-week-migration-'))
  const filename = join(directory, 'homework.sqlite')
  const legacy = new DatabaseSync(filename)
  legacy.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE daily_completion (
      day TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'browser',
      completed_at TEXT NOT NULL,
      PRIMARY KEY (day, activity_id)
    );
    CREATE TABLE optional_completion (
      session_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    INSERT INTO daily_completion VALUES ('Monday', 'math', 'browser', '2026-10-01T12:00:00.000Z');
    INSERT INTO optional_completion VALUES ('voena:0', '2026-10-01T12:00:00.000Z');
  `)
  legacy.close()

  try {
    const clock = controlledClock()
    const first = createStore(filename, clock.options())
    assert.deepEqual(first.loadState().requiredByDay.Monday, ['math'])
    assert.deepEqual(first.loadState().optionalCompleted, ['voena:0'])
    first.close()

    const reopened = createStore(filename, clock.options())
    assert.deepEqual(reopened.loadState().requiredByDay.Monday, ['math'])
    assert.deepEqual(reopened.loadState().optionalCompleted, ['voena:0'])
    assert.equal(
      reopened.db.prepare('SELECT count(*) AS count FROM weekly_optional_completion').get().count,
      1,
    )
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('existing Level Chinese and Du Chinese practice credit moves into the daily checklist', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-chinese-migration-'))
  const filename = join(directory, 'homework.sqlite')

  try {
    const clock = controlledClock('2026-10-05T16:00:00.000Z')
    const initial = createStore(filename, clock.options())
    const { weekId } = initial.loadState().weekContext
    initial.close()

    const legacy = new DatabaseSync(filename)
    legacy.prepare(`DELETE FROM app_meta WHERE key = 'daily_chinese_activities_migrated'`).run()
    legacy.prepare('UPDATE weekly_plan SET optional_target = 13 WHERE week_id = ?').run(weekId)
    const insertOptional = legacy.prepare(`
      INSERT INTO weekly_optional_completion (week_id, session_key, completed_at)
      VALUES (?, ?, ?)
    `)
    insertOptional.run(weekId, 'level-chinese:0', '2026-10-05T16:05:00.000Z')
    insertOptional.run(weekId, 'du-chinese:0', '2026-10-05T16:10:00.000Z')
    insertOptional.run(weekId, 'voena:0', '2026-10-05T16:15:00.000Z')
    legacy.close()

    const migrated = createStore(filename, clock.options())
    const state = migrated.loadState()
    assert.equal(state.requiredByDay.Monday.includes('level-chinese'), true)
    assert.equal(state.requiredByDay.Monday.includes('du-chinese'), true)
    assert.deepEqual(state.optionalCompleted, ['voena:0'])
    assert.equal(
      migrated.db.prepare('SELECT optional_target FROM weekly_plan WHERE week_id = ?').get(weekId).optional_target,
      9,
    )
    assert.equal(
      migrated.listAudit().filter((event) => event.eventType === 'chinese_activities_moved_to_daily_checklist').length,
      1,
    )
    migrated.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a Sunday upgrade archives legacy weekly data instead of carrying it into the new pool', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fionnbar-sunday-migration-'))
  const filename = join(directory, 'homework.sqlite')
  const legacy = new DatabaseSync(filename)
  legacy.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE weekly_plan (
      week_id TEXT PRIMARY KEY,
      optional_target INTEGER NOT NULL DEFAULT 13,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE daily_completion (
      day TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'browser',
      completed_at TEXT NOT NULL,
      PRIMARY KEY (day, activity_id)
    );
    CREATE TABLE optional_completion (
      session_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
    INSERT INTO settings VALUES ('entered', '1');
    INSERT INTO weekly_plan VALUES ('2026-09-28', 13, 0, '2026-10-03T20:00:00.000Z');
    INSERT INTO daily_completion VALUES ('Friday', 'math', 'browser', '2026-10-03T20:00:00.000Z');
    INSERT INTO optional_completion VALUES ('voena:0', '2026-10-03T20:00:00.000Z');
  `)
  legacy.close()

  try {
    const clock = controlledClock('2026-10-04T11:00:00.000Z')
    const store = createStore(filename, clock.options())
    const state = store.loadState()
    assert.equal(state.weekContext.weekId, '2026-10-05')
    assert.equal(state.entered, false)
    assert.deepEqual(state.requiredByDay.Friday, [])
    assert.deepEqual(state.optionalCompleted, [])
    assert.equal(
      store.db.prepare('SELECT count(*) AS count FROM weekly_optional_completion WHERE week_id = ?')
        .get('2026-09-28').count,
      1,
    )
    assert.equal(
      store.db.prepare('SELECT archived FROM weekly_plan WHERE week_id = ?').get('2026-09-28').archived,
      1,
    )
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a controlled session completed after rollover stays with the week where it started', () => {
  const clock = controlledClock('2026-10-04T10:59:58.000Z')
  const store = createStore(':memory:', clock.options())
  const session = store.startSession({
    kind: 'optional',
    activityId: 'voena',
    sessionKey: 'voena:0',
    label: 'Voena · Session 1',
    targetSeconds: 5,
  })
  assert.equal(session.weekId, '2026-09-28')

  clock.advance(5_000)
  assert.equal(store.heartbeatSession(session.id, true).status, 'completed')
  const current = store.loadState()
  assert.equal(current.weekContext.weekId, '2026-10-05')
  assert.deepEqual(current.optionalCompleted, [])
  assert.equal(
    store.db.prepare(`
      SELECT count(*) AS count FROM weekly_optional_completion
      WHERE week_id = ? AND session_key = ?
    `).get('2026-09-28', 'voena:0').count,
    1,
  )
  store.close()
})

test('Friday Free Mode unlocks once, relocks after a correction, and resets on rollover', () => {
  const clock = controlledClock('2026-10-09T16:00:00.000Z')
  const store = createStore(':memory:', clock.options())
  const required = [
    'mandarin', 'level-chinese', 'du-chinese', 'math', 'english-packet',
    'reading-strategies', 'ninja-dojo',
  ]
  const optional = [
    'voena:0', 'voena:1', 'voena:2',
    'drums:0', 'drums:1', 'drums:2',
    'band:0', 'band:1', 'band:2',
  ]

  for (const activityId of required) {
    store.setDailyCompletion({
      day: 'Friday',
      activityId,
      completed: true,
      method: 'parent-override',
    })
  }
  const locked = store.loadState()
  assert.equal(locked.freeModeByDay.Friday, undefined)

  locked.optionalCompleted = optional
  const unlocked = store.saveState(locked)
  assert.match(unlocked.freeModeByDay.Friday, /^2026-10-09T/)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'free_mode_unlocked').length,
    1,
  )
  store.loadState()
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'free_mode_unlocked').length,
    1,
  )

  const relocked = store.setDailyCompletion({
    day: 'Friday',
    activityId: 'math',
    completed: false,
    method: 'parent-override',
  })
  assert.equal(relocked.freeModeByDay.Friday, undefined)
  assert.equal(
    store.listAudit().filter((event) => event.eventType === 'free_mode_relocked').length,
    1,
  )

  store.setDailyCompletion({
    day: 'Friday',
    activityId: 'math',
    completed: true,
    method: 'parent-override',
  })
  assert.ok(store.loadState().freeModeByDay.Friday)

  clock.setWall('2026-10-11T11:00:00.000Z')
  const nextWeek = store.loadState()
  assert.deepEqual(nextWeek.freeModeByDay, {})
  assert.equal(
    store.db.prepare('SELECT count(*) AS count FROM free_mode_unlock WHERE week_id = ?')
      .get('2026-10-05').count,
    1,
  )
  store.close()
})
