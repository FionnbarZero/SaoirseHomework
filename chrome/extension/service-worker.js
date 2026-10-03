import {
  MANAGED_RULE_LIMIT,
  MANAGED_RULE_START,
  buildDynamicRules,
  isAllowedUrl,
  isYoutubeUrl,
  originForUrl,
} from './rules.js'

const SERVICE_BASE = 'http://127.0.0.1:4179'
const STATUS_KEY = 'fionnbarPolicyStatus'
const PLAYBACK_SAMPLE_MAX_AGE_MS = 7_000
const PLAYBACK_SYNC_INTERVAL_MS = 4_000
const playbackByTab = new Map()
let lastPlaybackSyncAt = 0
let syncInFlight = null

async function replaceManagedRules(rules) {
  const current = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = current
    .filter((rule) => rule.id >= MANAGED_RULE_START && rule.id < MANAGED_RULE_START + MANAGED_RULE_LIMIT)
    .map((rule) => rule.id)
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules })
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) return null
  const browserWindow = await chrome.windows.get(tab.windowId).catch(() => null)
  return { ...tab, windowFocused: browserWindow?.focused === true }
}

async function setBadge(mode, healthy) {
  const text = healthy ? (mode === 'homework' ? 'H' : mode === 'free' ? 'F' : '') : '!'
  const color = healthy ? (mode === 'homework' ? '#b4533f' : '#34736a') : '#9a7121'
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
}

async function postHeartbeat(status, tab) {
  const allowed = !status.policy.restrictNavigation || isAllowedUrl(
    tab?.url ?? '',
    status.policy.allowedDomains,
    status.policy.allowedOrigins,
  )
  const decision = tab?.url ? (allowed ? 'allowed' : 'blocked') : 'unavailable'
  const playback = tab?.id == null ? null : playbackByTab.get(tab.id)
  const playbackActive = Boolean(
    status.activeSession?.kind === 'reward' &&
    allowed &&
    tab?.windowFocused &&
    isYoutubeUrl(tab?.url ?? '') &&
    playback?.playbackActive &&
    Date.now() - playback.reportedAt <= PLAYBACK_SAMPLE_MAX_AGE_MS,
  )
  const response = await fetch(`${SERVICE_BASE}/api/chrome/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      mode: status.mode,
      activeOrigin: originForUrl(tab?.url),
      decision,
      policyVersion: status.policy.version,
      playbackActive,
    }),
  })
  if (!response.ok) throw new Error(`Heartbeat returned ${response.status}`)
  const body = await response.json()
  return { decision, status: body.status ?? status }
}

async function windowExists(windowId) {
  if (!Number.isInteger(windowId)) return false
  return Boolean(await chrome.windows.get(windowId).catch(() => null))
}

async function closeYoutubeAndRestore(previous) {
  const tabs = await chrome.tabs.query({})
  const youtubeTabIds = tabs.filter((tab) => tab.id != null && isYoutubeUrl(tab.url ?? '')).map((tab) => tab.id)
  if (youtubeTabIds.length) await chrome.tabs.remove(youtubeTabIds).catch(() => {})
  if (Number.isInteger(previous.rewardReturnTabId)) {
    const returnTab = await chrome.tabs.get(previous.rewardReturnTabId).catch(() => null)
    if (returnTab?.id != null) {
      await chrome.tabs.update(returnTab.id, { active: true }).catch(() => {})
      await chrome.windows.update(returnTab.windowId, { focused: true }).catch(() => {})
    }
  }
}

function isActiveReward(status) {
  return status.activeSession?.kind === 'reward' && status.activeSession.status !== 'completed'
}

async function reconcileRewardWindow(status, previous) {
  if (!isActiveReward(status)) {
    if (previous.rewardSessionId) await closeYoutubeAndRestore(previous)
    return { rewardSessionId: null, rewardWindowId: null, rewardReturnTabId: null }
  }

  const sessionId = status.activeSession.id
  const existingWindow = previous.rewardSessionId === sessionId &&
    await windowExists(previous.rewardWindowId)
  if (existingWindow) {
    return {
      rewardSessionId: sessionId,
      rewardWindowId: previous.rewardWindowId,
      rewardReturnTabId: previous.rewardReturnTabId ?? null,
    }
  }

  if (previous.rewardSessionId && previous.rewardSessionId !== sessionId) {
    await closeYoutubeAndRestore(previous)
  }
  const returnTab = await activeTab()
  const rewardWindow = await chrome.windows.create({
    url: status.activeSession.launchUrl || 'https://www.youtube.com/',
    type: 'popup',
    focused: true,
    width: 1100,
    height: 760,
  })
  return {
    rewardSessionId: sessionId,
    rewardWindowId: rewardWindow.id ?? null,
    rewardReturnTabId: returnTab?.id ?? previous.rewardReturnTabId ?? null,
  }
}

async function reportBlockedNavigation(url) {
  const saved = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY]
  if (!saved?.homeworkMode || isAllowedUrl(url, saved.allowedDomains, saved.allowedOrigins)) return
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

async function performPolicySync(trigger) {
  try {
    const response = await fetch(`${SERVICE_BASE}/api/chrome/status`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Service returned ${response.status}`)
    const status = await response.json()
    const rules = buildDynamicRules(
      status.policy.restrictNavigation,
      status.policy.allowedDomains,
      status.policy.allowedOrigins,
    )
    await replaceManagedRules(rules)
    const previous = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] ?? {}
    let rewardWindow = await reconcileRewardWindow(status, previous)
    let tab = await activeTab()
    const shouldNavigatePhase = Boolean(
      status.activeSession?.navigateOnPhaseStart &&
      status.activeSession?.launchUrl &&
      previous.activeSessionPhaseToken &&
      previous.activeSessionPhaseToken !== status.activeSession.phaseToken &&
      tab?.id,
    )
    if (shouldNavigatePhase) {
      await chrome.tabs.update(tab.id, { url: status.activeSession.launchUrl })
      tab = { ...tab, url: status.activeSession.launchUrl }
    }
    const heartbeat = await postHeartbeat(status, tab)
    const effectiveStatus = heartbeat.status
    if (!isActiveReward(heartbeat.status) && rewardWindow.rewardSessionId) {
      await closeYoutubeAndRestore(rewardWindow)
      rewardWindow = { rewardSessionId: null, rewardWindowId: null, rewardReturnTabId: null }
      await replaceManagedRules(buildDynamicRules(
        effectiveStatus.policy.restrictNavigation,
        effectiveStatus.policy.allowedDomains,
        effectiveStatus.policy.allowedOrigins,
      ))
    }
    const saved = {
      connected: true,
      trigger,
      mode: effectiveStatus.mode,
      homeworkMode: effectiveStatus.homeworkMode,
      policyVersion: effectiveStatus.policy.version,
      allowedDomains: effectiveStatus.policy.allowedDomains,
      allowedOrigins: effectiveStatus.policy.allowedOrigins,
      activeOrigin: originForUrl(tab?.url),
      activeSessionPhaseToken: effectiveStatus.activeSession?.phaseToken ?? null,
      decision: heartbeat.decision,
      ...rewardWindow,
      lastCheckedAt: new Date().toISOString(),
      error: null,
    }
    await chrome.storage.local.set({ [STATUS_KEY]: saved })
    await setBadge(effectiveStatus.mode, true)
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

function syncPolicy(trigger = 'scheduled') {
  if (syncInFlight) return syncInFlight
  syncInFlight = performPolicySync(trigger).finally(() => { syncInFlight = null })
  return syncInFlight
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
chrome.tabs.onRemoved.addListener((tabId) => { playbackByTab.delete(tabId) })
chrome.windows.onFocusChanged.addListener(() => { void syncPolicy('window-focus') })
setInterval(() => { void syncPolicy('five-second-heartbeat') }, 5_000)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) void reportBlockedNavigation(details.url)
})
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) void syncPolicy('navigation')
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'youtubePlayback' && _sender.tab?.id != null) {
    playbackByTab.set(_sender.tab.id, {
      playbackActive: message.playbackActive === true && message.adPlaying !== true,
      reportedAt: Date.now(),
    })
    if (Date.now() - lastPlaybackSyncAt >= PLAYBACK_SYNC_INTERVAL_MS) {
      lastPlaybackSyncAt = Date.now()
      void syncPolicy('youtube-playback')
    }
    return false
  }
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
