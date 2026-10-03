import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildActivitySessionPlan,
  emptyActivityConfiguration,
  normalizeActivityConfiguration,
} from '../server/activity-config.mjs'

test('activity configuration stays fail-closed until every required URL is present', () => {
  const empty = emptyActivityConfiguration()
  assert.equal(empty.ninjaDojo.ready, false)
  assert.equal(empty.duChinese.ready, false)
  assert.equal(empty.levelChinese.ready, false)
  assert.throws(
    () => buildActivitySessionPlan('du-chinese', empty),
    (error) => error.status === 409 && error.code === 'activity_not_configured',
  )
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
