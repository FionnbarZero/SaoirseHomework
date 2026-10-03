import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MANAGED_RULE_START,
  buildDynamicRules,
  isAllowedUrl,
  isYoutubeUrl,
  normalizeDomains,
  normalizeOrigins,
  originForUrl,
} from '../chrome/extension/rules.js'

test('Chrome navigation rules allow approved domains and origins over the catch-all redirect', () => {
  const rules = buildDynamicRules(true, ['127.0.0.1', 'youtube.com'], ['https://school.example:8443'])
  assert.equal(rules[0].id, MANAGED_RULE_START)
  assert.equal(rules[0].action.type, 'redirect')
  assert.equal(rules[0].priority, 1)
  assert.deepEqual(rules.slice(1).map((rule) => rule.action.type), ['allow', 'allow', 'allow'])
  assert.equal(rules.every((rule, index) => index === 0 || rule.priority === 2), true)
})

test('Chrome navigation rules are removed outside Homework mode', () => {
  assert.deepEqual(buildDynamicRules(false, ['127.0.0.1']), [])
})

test('domain matching rejects lookalikes while allowing subdomains', () => {
  assert.equal(isAllowedUrl('http://127.0.0.1:4179/', ['127.0.0.1']), true)
  assert.equal(isAllowedUrl('https://www.youtube.com/watch?v=1', ['youtube.com']), true)
  assert.equal(isAllowedUrl('https://youtube.com.evil.example/', ['youtube.com']), false)
  assert.equal(isAllowedUrl('https://example.com/', ['youtube.com']), false)
})

test('exact origins reject alternate schemes, ports, and subdomains', () => {
  const origins = ['https://school.example:8443']
  assert.equal(isAllowedUrl('https://school.example:8443/lesson', [], origins), true)
  assert.equal(isAllowedUrl('https://school.example/lesson', [], origins), false)
  assert.equal(isAllowedUrl('http://school.example:8443/lesson', [], origins), false)
  assert.equal(isAllowedUrl('https://child.school.example:8443/lesson', [], origins), false)
  assert.deepEqual(normalizeOrigins(['https://school.example:8443/path']), origins)
})

test('policy domains are normalized, deduplicated, and bounded', () => {
  assert.deepEqual(normalizeDomains(['YouTube.com', '.youtube.com.', 'bad domain']), ['youtube.com'])
  assert.equal(normalizeDomains(Array.from({ length: 200 }, (_, index) => `d${index}.example`)).length, 99)
  assert.equal(originForUrl('chrome://extensions'), null)
  assert.equal(originForUrl('https://example.com/path'), 'https://example.com')
})

test('YouTube playback URLs reject lookalike and insecure hosts', () => {
  assert.equal(isYoutubeUrl('https://www.youtube.com/watch?v=1'), true)
  assert.equal(isYoutubeUrl('https://music.youtube.com/watch?v=1'), true)
  assert.equal(isYoutubeUrl('https://youtu.be/example'), true)
  assert.equal(isYoutubeUrl('http://www.youtube.com/watch?v=1'), false)
  assert.equal(isYoutubeUrl('https://youtube.com.evil.example/watch?v=1'), false)
})
