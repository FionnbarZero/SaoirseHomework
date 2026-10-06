import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_DU_CHINESE_FLASHCARD_URL,
  DEFAULT_CLEVER_URL,
  DEFAULT_DU_CHINESE_READING_URL,
  DEFAULT_NINJA_DOJO_URL,
  buildActivitySessionPlan,
  emptyActivityConfiguration,
  normalizeActivityConfiguration,
} from '../server/activity-config.mjs'

test('reviewed activity links are ready while activities without links stay fail-closed', () => {
  const empty = emptyActivityConfiguration()
  assert.equal(empty.ninjaDojo.ready, true)
  assert.equal(empty.ninjaDojo.launchUrl, DEFAULT_NINJA_DOJO_URL)
  assert.deepEqual(empty.ninjaDojo.allowedOrigins, ['https://weeklydictation-g5-beta.web.app'])
  assert.equal(empty.duChinese.ready, true)
  assert.equal(empty.duChinese.readingUrl, DEFAULT_DU_CHINESE_READING_URL)
  assert.equal(empty.duChinese.flashcardUrl, DEFAULT_DU_CHINESE_FLASHCARD_URL)
  assert.deepEqual(empty.duChinese.allowedOrigins, ['https://duchinese.net'])
  assert.equal(empty.levelChinese.ready, false)
  assert.equal(empty.levelChinese.cleverUrl, DEFAULT_CLEVER_URL)
  assert.deepEqual(empty.levelChinese.allowedOrigins, ['https://clever.com'])
  const ninja = buildActivitySessionPlan('ninja-dojo', empty)
  assert.equal(ninja.phases[0].launchUrl, DEFAULT_NINJA_DOJO_URL)
  assert.deepEqual(ninja.phases[0].creditOrigins, ['https://weeklydictation-g5-beta.web.app'])
  const du = buildActivitySessionPlan('du-chinese', empty)
  assert.equal(du.phases[0].launchUrl, DEFAULT_DU_CHINESE_READING_URL)
  assert.equal(du.phases[1].launchUrl, DEFAULT_DU_CHINESE_FLASHCARD_URL)
  assert.throws(
    () => buildActivitySessionPlan('level-chinese', empty),
    (error) => error.status === 409 && error.code === 'activity_not_configured',
  )
})

test('blank saved Clever links use clever.com without enabling unverified learning credit', () => {
  const config = normalizeActivityConfiguration({ levelChinese: { cleverUrl: '', learningUrl: '' } })
  assert.equal(config.levelChinese.cleverUrl, DEFAULT_CLEVER_URL)
  assert.equal(config.levelChinese.ready, false)
  assert.deepEqual(config.levelChinese.allowedOrigins, ['https://clever.com'])
  assert.throws(() => buildActivitySessionPlan('level-chinese', config), { code: 'activity_not_configured' })
})

test('activity configuration normalizes launch and redirect origins exactly', () => {
  const configuration = normalizeActivityConfiguration({
    ninjaDojo: {
      launchUrl: 'https://hub.example.edu/grade-5',
      allowedOrigins: ['https://login.example.edu/path', 'https://hub.example.edu/other'],
    },
    duChinese: {
      readingUrl: 'https://read.example.com/story',
      flashcardUrl: 'https://cards.example.com/review',
      allowedOrigins: ['https://auth.example.com/login'],
    },
    levelChinese: {
      cleverUrl: 'https://clever.com/in/example',
      learningUrl: 'https://level.example.org/learn',
      allowedOrigins: ['https://district.example.org/oauth'],
    },
  })

  assert.equal(configuration.ninjaDojo.ready, true)
  assert.deepEqual(configuration.ninjaDojo.allowedOrigins, [
    'https://hub.example.edu',
    'https://login.example.edu',
  ])
  assert.equal(configuration.duChinese.ready, true)
  assert.deepEqual(configuration.duChinese.allowedOrigins, [
    'https://read.example.com',
    'https://cards.example.com',
    'https://auth.example.com',
  ])
  assert.equal(configuration.levelChinese.ready, true)
  const changed = normalizeActivityConfiguration({
    ...configuration,
    ninjaDojo: { ...configuration.ninjaDojo, launchUrl: 'https://new-hub.example.edu/grade-5' },
  })
  assert.deepEqual(changed.ninjaDojo.allowedOrigins, [
    'https://new-hub.example.edu',
    'https://login.example.edu',
  ])
  assert.throws(
    () => normalizeActivityConfiguration({
      ...configuration,
      ninjaDojo: { launchUrl: 'http://not-secure.example', allowedOrigins: [] },
    }),
    /must use HTTPS/,
  )
})

test('configured session plans preserve the required activity phases', () => {
  const reading = buildActivitySessionPlan('independent-reading', emptyActivityConfiguration())
  assert.equal(reading.targetSeconds, 1200)
  assert.equal(reading.phases[0].targetSeconds, 1200)
  assert.equal(reading.phases[0].verification, 'browser-focus')
  const configuration = normalizeActivityConfiguration({
    ninjaDojo: { launchUrl: 'https://hub.example.edu/grade-5', allowedOrigins: [] },
    duChinese: {
      readingUrl: 'https://du.example/read',
      flashcardUrl: 'https://du.example/flashcards',
      allowedOrigins: [],
    },
    levelChinese: {
      cleverUrl: 'https://clever.example/login',
      learningUrl: 'https://level.example/learn',
      allowedOrigins: ['https://district.example/oauth'],
    },
  })

  const ninja = buildActivitySessionPlan('ninja-dojo', configuration)
  assert.equal(ninja.targetSeconds, 17 * 60)
  assert.equal(ninja.phases[0].verification, 'managed-chrome')

  const du = buildActivitySessionPlan('du-chinese', configuration)
  assert.deepEqual(du.phases.map((phase) => [phase.id, phase.targetSeconds]), [
    ['reading', 13 * 60],
    ['flashcards', 7 * 60],
  ])
  assert.equal(du.phases[1].navigateOnStart, true)

  const level = buildActivitySessionPlan('level-chinese', configuration)
  assert.deepEqual(level.phases.map((phase) => [phase.id, phase.targetSeconds]), [
    ['clever-login', 0],
    ['level-learning', 20 * 60],
  ])
  assert.deepEqual(level.phases[0].advanceOrigins, ['https://level.example'])
})
