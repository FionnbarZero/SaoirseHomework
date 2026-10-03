import {
  MANAGED_RULE_LIMIT,
  MANAGED_RULE_START,
  buildDynamicRules,
  isAllowedUrl,
  originForUrl,
} from './rules.js'

const SERVICE_BASE = 'http://127.0.0.1:4179'
const STATUS_KEY = 'fionnbarPolicyStatus'

async function replaceManagedRules(rules) {
  const current = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = current
    .filter((rule) => rule.id >= MANAGED_RULE_START && rule.id < MANAGED_RULE_START + MANAGED_RULE_LIMIT)
    .map((rule) => rule.id)
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules })
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab ?? null
}

async function setBadge(mode, healthy) {
  const text = healthy ? (mode === 'homework' ? 'H' : mode === 'free' ? 'F' : '') : '!'
  const color = healthy ? (mode === 'homework' ? '#b4533f' : '#34736a') : '#9a7121'
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
}

async function postHeartbeat(status, tab) {
  const allowed = !status.policy.restrictNavigation || isAllowedUrl(tab?.url ?? '', status.policy.allowedDomains)
  const decision = tab?.url ? (allowed ? 'allowed' : 'blocked') : 'unavailable'
  await fetch(`${SERVICE_BASE}/api/chrome/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      mode: status.mode,
      activeOrigin: originForUrl(tab?.url),
      decision,
      policyVersion: status.policy.version,
    }),
  })
  return decision
}

async function reportBlockedNavigation(url) {
  const saved = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY]
  if (!saved?.homeworkMode || isAllowedUrl(url, saved.allowedDomains)) return
  try {
    await fetch(`${SERVICE_BASE}/api/chrome/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        mode: saved.mode,
        activeOrigin: originForUrl(url),
        decision: 'blocked',
        policyVersion: saved.policyVersion,
      }),
    })
  } catch {
    // Managed rules remain installed; the next successful sync reports health.
  }
}

async function syncPolicy(trigger = 'scheduled') {
  try {
    const response = await fetch(`${SERVICE_BASE}/api/chrome/status`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Service returned ${response.status}`)
    const status = await response.json()
    const rules = buildDynamicRules(status.policy.restrictNavigation, status.policy.allowedDomains)
    await replaceManagedRules(rules)
    const tab = await activeTab()
    const decision = await postHeartbeat(status, tab)
    const saved = {
      connected: true,
      trigger,
      mode: status.mode,
      homeworkMode: status.homeworkMode,
      policyVersion: status.policy.version,
      allowedDomains: status.policy.allowedDomains,
      activeOrigin: originForUrl(tab?.url),
      decision,
      lastCheckedAt: new Date().toISOString(),
      error: null,
    }
    await chrome.storage.local.set({ [STATUS_KEY]: saved })
    await setBadge(status.mode, true)
    return saved
  } catch (error) {
    const previous = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] ?? {}
    const saved = {
      ...previous,
      connected: false,
      trigger,
      lastCheckedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Local service unavailable',
    }
    await chrome.storage.local.set({ [STATUS_KEY]: saved })
    await setBadge(previous.mode, false)
    return saved
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('homework-policy-sync', { periodInMinutes: 0.5 })
  void syncPolicy('installed')
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('homework-policy-sync', { periodInMinutes: 0.5 })
  void syncPolicy('startup')
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'homework-policy-sync') void syncPolicy('scheduled')
})

chrome.tabs.onActivated.addListener(() => { void syncPolicy('tab-activated') })
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') void syncPolicy('tab-updated')
})
chrome.windows.onFocusChanged.addListener(() => { void syncPolicy('window-focus') })
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) void reportBlockedNavigation(details.url)
})
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) void syncPolicy('navigation')
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'getStatus') {
    chrome.storage.local.get(STATUS_KEY).then((value) => sendResponse(value[STATUS_KEY] ?? null))
    return true
  }
  if (message?.type === 'syncNow') {
    syncPolicy('manual').then(sendResponse)
    return true
  }
  return false
})
