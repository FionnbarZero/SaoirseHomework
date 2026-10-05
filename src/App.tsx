import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  FileText,
  Gift,
  Home,
  LockKeyhole,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Send,
  Sparkles,
  Star,
  Trophy,
  Volume2,
  X,
} from 'lucide-react'
import {
  DAYS,
  OPTIONAL_ACTIVITIES,
  OPTIONAL_SESSION_TOTAL,
  OPTIONAL_TARGETS,
  REQUIRED_ACTIVITIES,
  activeRequiredActivities,
  dayIsComplete,
  defaultState,
  formatTimer,
  getBrowserWeekContext,
  getFridayFunSummary,
  getToday,
  getWeekLabel,
  optionalSessionKey,
  progressForDay,
  type ActiveTimer,
  type ActivityConfiguration,
  type AppState,
  type DayName,
  type Draft,
  type SentenceMeaningReview,
} from './domain'
import {
  advanceFindingProgress,
  applyCompletedCorrections,
  draftBelongsToWritingActivity,
  inspectAmbiguousDraft,
  inspectWritingFindings,
  resolveWritingChoice,
  scoreWritingResponses,
  selectedMeaningMatches,
  skipRemainingWritingTrials,
  type WritingAnswerState,
  writingActivityKey,
  writingReviewStatus,
} from './writing'
import {
  applyCompletedSpellingCorrections,
  completedSpellingSteps,
  inspectSpelling,
  nextSpellingStep,
  submitSpellingAnswer,
} from './spelling'
import {
  acknowledgeControlledSession,
  addParentRewardCredit,
  beginLiveGoogleAuthorization,
  connectMockGoogle,
  completeWritingGame,
  disconnectLiveGoogle,
  disconnectMockGoogle,
  endControlledSession,
  heartbeatControlledSession,
  hydrateFromService,
  getParentAuthorizationStatus,
  getAiProofreadingStatus,
  getSecurityStatus,
  getWritingLogStatus,
  loadStateFromService,
  lockParentSession,
  pollParentAuthorization,
  proofreadWriting,
  retrySentenceMeaning,
  resetParentPreviewData,
  retryLiveGoogleDelivery,
  runLiveGoogleDelivery,
  runMockGoogleDelivery,
  saveActivityConfiguration,
  saveAiProofreadingMode,
  saveLiveGoogleConfiguration,
  saveStateToService,
  saveWritingDictionary,
  saveWritingReviewStatus,
  setDailyCompletion,
  startControlledSession,
  startLearningSession,
  startParentAuthorization,
  startReadingGame as startReadingGameSession,
  syncWritingLog,
  ServiceRequestError,
  type ParentAuthorizationStatus,
  type AiProofreadingMode,
  type AiProofreadingStatus,
  type SecurityStatus,
  type ServiceMeta,
  type WritingLogState,
} from './service'

type View = 'path' | 'day' | 'options' | 'writing' | 'rewards' | 'parent' | 'session'

const STORAGE_KEY = 'fionnbar-homework-v1'
const SECURITY_STATUS_KEY = 'fionnbar-homework-security-v1'

function isStaleWeekError(error: unknown) {
  return error instanceof ServiceRequestError && error.code === 'stale_week'
}

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultState
    const parsed = JSON.parse(saved) as Partial<AppState>
    const savedConfiguration = parsed.activityConfiguration
    return {
      ...defaultState,
      ...parsed,
      requiredByDay: { ...defaultState.requiredByDay, ...parsed.requiredByDay },
      freeModeByDay: { ...defaultState.freeModeByDay, ...parsed.freeModeByDay },
      writingDictionary: {
        knownNames: parsed.writingDictionary?.knownNames ?? defaultState.writingDictionary.knownNames,
        knownPlaces: parsed.writingDictionary?.knownPlaces ?? defaultState.writingDictionary.knownPlaces,
      },
      writingReviewQueue: Array.isArray(parsed.writingReviewQueue) ? parsed.writingReviewQueue : [],
      activityConfiguration: {
        ninjaDojo: { ...defaultState.activityConfiguration.ninjaDojo, ...savedConfiguration?.ninjaDojo },
        duChinese: { ...defaultState.activityConfiguration.duChinese, ...savedConfiguration?.duChinese },
        levelChinese: { ...defaultState.activityConfiguration.levelChinese, ...savedConfiguration?.levelChinese },
      },
    }
  } catch {
    return defaultState
  }
}

function loadSecurityStatus(): SecurityStatus | null {
  try {
    const saved = localStorage.getItem(SECURITY_STATUS_KEY)
    return saved ? JSON.parse(saved) as SecurityStatus : null
  } catch {
    return null
  }
}

function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [view, setView] = useState<View>(state.activeTimer ? 'session' : 'path')
  const [selectedDay, setSelectedDay] = useState<DayName>(getToday)
  const [serviceStatus, setServiceStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [serviceMeta, setServiceMeta] = useState<ServiceMeta | null>(null)
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(loadSecurityStatus)
  const [hydrated, setHydrated] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [entryStarting, setEntryStarting] = useState(false)
  const [entryError, setEntryError] = useState('')
  const latestState = useRef(state)
  const heartbeatInFlight = useRef(false)
  const sessionWantsRunning = useRef(Boolean(state.activeTimer?.running))

  useEffect(() => {
    latestState.current = state
  }, [state])

  useEffect(() => {
    let cancelled = false
    hydrateFromService(latestState.current)
      .then(({ state: storedState, meta }) => {
        if (cancelled) return
        sessionWantsRunning.current = Boolean(storedState.activeTimer?.running)
        setState(storedState)
        if (storedState.activeTimer) setView('session')
        setServiceMeta(meta)
        setServiceStatus('online')
        setHydrated(true)
      })
      .catch(() => {
        if (cancelled) return
        setServiceStatus('offline')
        setHydrated(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    if (!hydrated || serviceStatus !== 'online' || state.activeTimer) return
    const timeout = window.setTimeout(() => {
      saveStateToService(state)
        .then(({ meta }) => setServiceMeta(meta))
        .catch((error) => {
          if (isStaleWeekError(error)) {
            loadStateFromService()
              .then(({ state: storedState, meta }) => {
                setState(storedState)
                setServiceMeta(meta)
                setServiceStatus('online')
              })
              .catch(() => setServiceStatus('offline'))
            return
          }
          setServiceStatus('offline')
        })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [state, hydrated, serviceStatus])

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    let refreshing = false
    const refreshHomeworkDay = () => {
      const next = getBrowserWeekContext()
      const current = latestState.current.weekContext
      if (next.weekId === current.weekId && next.localDay === current.localDay) return

      if (serviceStatus !== 'online') {
        setState((stateNow) => ({ ...stateNow, weekContext: next }))
        return
      }
      if (refreshing) return
      refreshing = true
      loadStateFromService()
        .then(({ state: storedState, meta }) => {
          if (cancelled) return
          setState(storedState)
          setServiceMeta(meta)
        })
        .catch(() => {
          if (!cancelled) setServiceStatus('offline')
        })
        .finally(() => { refreshing = false })
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshHomeworkDay()
    }
    const interval = window.setInterval(refreshHomeworkDay, 60_000)
    window.addEventListener('focus', refreshHomeworkDay)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    refreshHomeworkDay()
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshHomeworkDay)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hydrated, serviceStatus])

  const reconnectService = () => {
    setServiceStatus('connecting')
    saveStateToService(latestState.current)
      .then(({ meta }) => {
        setServiceMeta(meta)
        setServiceStatus('online')
      })
      .catch(() => setServiceStatus('offline'))
  }

  useEffect(() => {
    const sessionId = state.activeTimer?.id
    if (!sessionId || state.activeTimer?.status === 'completed') return

    const reportFocus = async () => {
      if (heartbeatInFlight.current) return
      const timer = latestState.current.activeTimer
      if (!timer?.id || timer.id !== sessionId || timer.status === 'completed') return
      const active = sessionWantsRunning.current && document.visibilityState === 'visible' && document.hasFocus()
      heartbeatInFlight.current = true
      try {
        const response = await heartbeatControlledSession(sessionId, active)
        const intent = response.session?.managedChromeRequired
          ? Boolean(response.session.running)
          : response.session?.status === 'completed'
            ? false
            : sessionWantsRunning.current
        if (response.session?.status === 'completed') sessionWantsRunning.current = false
        setState({
          ...response.state,
          activeTimer: response.state.activeTimer
            ? { ...response.state.activeTimer, running: intent }
            : null,
        })
        setServiceMeta(response.meta)
        setServiceStatus('online')
        if (!response.session && timer.kind === 'reward') {
          sessionWantsRunning.current = false
          setView('rewards')
          setSessionError('No video started within two minutes, so your reward credit was returned.')
        } else {
          setSessionError('')
        }
      } catch (error) {
        setServiceStatus('offline')
        setSessionError(error instanceof Error ? error.message : 'The session service could not be reached.')
      } finally {
        heartbeatInFlight.current = false
      }
    }

    const handleFocusChange = () => { void reportFocus() }
    const interval = window.setInterval(reportFocus, 5_000)
    document.addEventListener('visibilitychange', handleFocusChange)
    window.addEventListener('focus', handleFocusChange)
    window.addEventListener('blur', handleFocusChange)
    void reportFocus()
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleFocusChange)
      window.removeEventListener('focus', handleFocusChange)
      window.removeEventListener('blur', handleFocusChange)
    }
  }, [state.activeTimer?.id, state.activeTimer?.status])

  useEffect(() => {
    if (view !== 'parent' || serviceStatus !== 'online' || state.activeTimer) return
    const refresh = () => {
      loadStateFromService()
        .then(({ state: storedState, meta }) => {
          setState(storedState)
          setServiceMeta(meta)
        })
        .catch(() => setServiceStatus('offline'))
    }
    const interval = window.setInterval(refresh, 5_000)
    return () => window.clearInterval(interval)
  }, [view, serviceStatus, state.activeTimer])

  useEffect(() => {
    if (serviceStatus !== 'online') return
    let cancelled = false
    const refresh = () => {
      getSecurityStatus()
        .then((status) => {
          if (!cancelled) {
            localStorage.setItem(SECURITY_STATUS_KEY, JSON.stringify(status))
            setSecurityStatus(status)
          }
        })
        .catch(() => {
          if (!cancelled) setServiceStatus('offline')
        })
    }
    void refresh()
    const interval = window.setInterval(refresh, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [serviceStatus, state.entered])

  const navigate = (next: View) => {
    if (state.activeTimer && next !== 'session') {
      setView('session')
      return
    }
    setView(next)
  }

  const openDay = (day: DayName) => {
    setSelectedDay(day)
    setView('day')
  }

  const toggleSelfReported = async (activityId: string) => {
    const completed = !latestState.current.requiredByDay[selectedDay].includes(activityId)
    if (serviceStatus === 'online') {
      try {
        const response = await setDailyCompletion(
          selectedDay,
          activityId,
          completed,
          'self-reported',
          latestState.current.weekContext.weekId,
        )
        setState(response.state)
        setServiceMeta(response.meta)
        return
      } catch (error) {
        if (isStaleWeekError(error)) {
          const response = await loadStateFromService()
          setState(response.state)
          setServiceMeta(response.meta)
          return
        }
        setServiceStatus('offline')
      }
    }
    setState((current) => ({
      ...current,
      requiredByDay: {
        ...current.requiredByDay,
        [selectedDay]: completed
          ? [...current.requiredByDay[selectedDay], activityId]
          : current.requiredByDay[selectedDay].filter((id) => id !== activityId),
      },
    }))
  }

  const startTimer = async (timer: ActiveTimer) => {
    if (serviceStatus !== 'online') {
      setSessionError('Controlled sessions need the local SQLite service. Reconnect it from the Parent screen.')
      return
    }
    try {
      await saveStateToService({ ...latestState.current, activeTimer: null })
      const response = await startControlledSession(timer)
      const wantsRunning = response.session?.managedChromeRequired ? Boolean(response.session.running) : true
      sessionWantsRunning.current = wantsRunning
      setState({
        ...response.state,
        activeTimer: response.session ? { ...response.session, running: wantsRunning } : null,
      })
      setServiceMeta(response.meta)
      setSessionError('')
      setView('session')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The controlled session could not start.')
    }
  }

  const startReadingGame = async (day: DayName) => {
    if (serviceStatus !== 'online') {
      setSessionError('The verified game needs the local SQLite service. Reconnect it from the Parent screen.')
      return
    }

    if (latestState.current.activeGameSession?.status === 'pending' && latestState.current.activeGameSession.day === day) {
      setSelectedDay(day)
      setView('writing')
      return
    }

    try {
      const response = await startReadingGameSession(day)
      setState(response.state)
      setServiceMeta(response.meta)
      setSessionError('')
      setSelectedDay(day)
      setView('writing')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The writing game could not start.')
    }
  }

  const finishWritingGame = async (draftId: string) => {
    const session = latestState.current.activeGameSession
    if (!session || session.status !== 'pending') throw new Error('Start the daily writing activity first.')
    if (serviceStatus !== 'online') throw new Error('Reconnect the local service before finishing the writing activity.')
    let response
    try {
      await saveStateToService(latestState.current)
      response = await completeWritingGame(session.id, draftId)
    } catch (error) {
      const recoverable = error instanceof ServiceRequestError &&
        ['session_expired', 'session_inactive', 'session_not_found'].includes(error.code)
      if (!recoverable) throw error

      const restarted = await startReadingGameSession(session.day)
      const refreshedAt = new Date().toISOString()
      const recoveredState: AppState = {
        ...restarted.state,
        drafts: latestState.current.drafts.map((draft) => draft.id === draftId
          ? { ...draft, updatedAt: refreshedAt }
          : draft),
        activeGameSession: restarted.gameSession,
      }
      await saveStateToService(recoveredState)
      response = await completeWritingGame(restarted.gameSession.id, draftId)
    }
    setState(response.state)
    setServiceMeta(response.meta)
    setSessionError('')
    setSelectedDay(session.day)
    setView('day')
  }

  const completeTimer = async () => {
    const timer = latestState.current.activeTimer
    if (!timer?.id || timer.status !== 'completed') return
    try {
      const response = await acknowledgeControlledSession(timer.id)
      setState(response.state)
      setServiceMeta(response.meta)
      setSessionError('')
      setView(timer.kind === 'optional' ? 'options' : timer.kind === 'reward' ? 'rewards' : 'day')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The completion could not be closed.')
    }
  }

  const cancelTimer = async () => {
    const timer = latestState.current.activeTimer
    if (!timer?.id) return
    try {
      const response = await endControlledSession(timer.id)
      sessionWantsRunning.current = false
      setState(response.state)
      setServiceMeta(response.meta)
      setSessionError('')
      setView(timer.kind === 'optional' ? 'options' : timer.kind === 'reward' ? 'rewards' : 'day')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The session could not be ended.')
    }
  }

  const toggleTimer = async () => {
    const timer = latestState.current.activeTimer
    if (!timer?.id || timer.status === 'completed') return
    const wantsRunning = !timer.running
    sessionWantsRunning.current = wantsRunning
    setState((current) => current.activeTimer
      ? { ...current, activeTimer: { ...current.activeTimer, running: wantsRunning } }
      : current)
    try {
      const active = wantsRunning && document.visibilityState === 'visible' && document.hasFocus()
      const response = await heartbeatControlledSession(timer.id, active)
      setState({
        ...response.state,
        activeTimer: response.state.activeTimer
          ? { ...response.state.activeTimer, running: wantsRunning }
          : null,
      })
      setServiceMeta(response.meta)
      setServiceStatus('online')
      setSessionError('')
    } catch (error) {
      setServiceStatus('offline')
      setSessionError(error instanceof Error ? error.message : 'The timer could not be updated.')
    }
  }

  const enterHomework = async () => {
    if (entryStarting) return
    setEntryStarting(true)
    setEntryError('')
    try {
      const response = await startLearningSession()
      setState(response.state)
      setServiceMeta(response.meta)
      setServiceStatus('online')
      setView('path')
    } catch (error) {
      setServiceStatus('offline')
      setEntryError(error instanceof Error
        ? error.message
        : 'Homework mode could not start. Ask a parent to restart the local service.')
    } finally {
      setEntryStarting(false)
    }
  }

  if (!state.entered) {
    return (
      <EntryScreen
        onEnter={() => { void enterHomework() }}
        starting={entryStarting}
        ready={hydrated}
        error={entryError}
      />
    )
  }

  const recoveryStatus = securityStatus?.mode === 'enforcing' && serviceStatus !== 'online'
    ? { ...securityStatus, locked: true, reasons: [...new Set([...securityStatus.reasons, 'service_unavailable' as const])] }
    : securityStatus
  if (recoveryStatus?.locked && view !== 'parent') {
    return (
      <RecoveryScreen
        status={recoveryStatus}
        openParent={() => setView('parent')}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} navigate={navigate} rewardCount={state.rewardCredits.length} />
      <main className="main-shell">
        <Topbar state={state} serviceStatus={serviceStatus} />
        <div className="page-wrap">
          {sessionError && (
            <div className="session-error" role="alert">
              <ShieldCheck size={17} /> <span>{sessionError}</span>
              <button onClick={() => setSessionError('')} aria-label="Dismiss message"><X size={16} /></button>
            </div>
          )}
          {view === 'path' && <PathView state={state} selectedDay={selectedDay} openDay={openDay} />}
          {view === 'day' && (
            <DayView
              state={state}
              day={selectedDay}
              setDay={setSelectedDay}
              toggleSelfReported={toggleSelfReported}
              startTimer={startTimer}
              startReadingGame={startReadingGame}
              openOptions={() => setView('options')}
              openPath={() => setView('path')}
              openRewards={() => setView('rewards')}
            />
          )}
          {view === 'options' && (
            <OptionalView state={state} startTimer={startTimer} onBack={() => setView('path')} />
          )}
          {view === 'writing' && (
            <WritingView
              key={writingActivityKey(
                state.weekContext.weekId,
                state.weekContext.localDay,
              )}
              state={state}
              setState={setState}
              serviceStatus={serviceStatus}
              finishWritingGame={finishWritingGame}
            />
          )}
          {view === 'rewards' && <RewardsView state={state} startTimer={startTimer} />}
          {view === 'parent' && (
            <ParentRoute
              state={state}
              setState={setState}
              day={selectedDay}
              setDay={setSelectedDay}
              serviceStatus={serviceStatus}
              serviceMeta={serviceMeta}
              reconnectService={reconnectService}
            />
          )}
          {view === 'session' && state.activeTimer && (
            <SessionView
              timer={state.activeTimer}
              toggle={toggleTimer}
              complete={completeTimer}
              cancel={cancelTimer}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function RecoveryScreen({ status, openParent }: { status: SecurityStatus; openParent: () => void }) {
  const guardianMissing = status.reasons.includes('guardian_unavailable')
  const chromeMissing = status.reasons.includes('managed_chrome_unavailable')
  const serviceMissing = status.reasons.includes('service_unavailable')
  const authorizationMissing = status.reasons.includes('parent_authorization_not_configured')
  return (
    <main className="recovery-screen">
      <section className="recovery-card" role="alert">
        <span className="recovery-icon"><LockKeyhole size={32} /></span>
        <p className="eyebrow">HOMEWORK MODE PAUSED</p>
        <h1>Parent repair needed.</h1>
        <p>No activity time or completion credit is being awarded while a required safety connection is unavailable.</p>
        <div className="recovery-reasons">
          {guardianMissing && <div><span className="dot" /><span><strong>macOS guardian is offline</strong><small>Restart the parent-installed guardian from an administrator account.</small></span></div>}
          {chromeMissing && <div><span className="dot" /><span><strong>Managed Chrome is offline</strong><small>Restore the managed extension and its policy heartbeat.</small></span></div>}
          {serviceMissing && <div><span className="dot" /><span><strong>Homework service is offline</strong><small>Restart the local service. Offline browser state cannot grant completion or reward credit.</small></span></div>}
          {authorizationMissing && <div><span className="dot" /><span><strong>Parent authorization is not configured</strong><small>Add the shared secret to the service and parent-owned guardian configuration.</small></span></div>}
        </div>
        {status.guardianConnected && !serviceMissing
          ? <button className="primary-button" onClick={openParent}><ShieldCheck size={17} /> Open Parent repair controls</button>
          : <p className="recovery-foot">Parent controls remain locked until the guardian reconnects.</p>}
      </section>
    </main>
  )
}

function EntryScreen({
  onEnter,
  starting,
  ready,
  error,
}: {
  onEnter: () => void
  starting: boolean
  ready: boolean
  error: string
}) {
  return (
    <main className="entry-screen">
      <div className="entry-decoration entry-star-one">✦</div>
      <div className="entry-decoration entry-star-two">✦</div>
      <div className="entry-decoration entry-squiggle">≈</div>
      <section className="entry-card">
        <div className="entry-badge"><Sparkles size={16} /> Ready when you are</div>
        <div className="entry-orbit" aria-hidden="true">
          <span className="orbit-book">Aa</span>
          <span className="orbit-note">♪</span>
          <span className="orbit-number">×</span>
          <span className="orbit-star">★</span>
        </div>
        <p className="eyebrow">FIONNBAR’S</p>
        <h1>Homework<br /><em>Quest</em></h1>
        <p className="entry-copy">A little progress every day adds up to a brilliant week.</p>
        <button className="primary-button enter-button" onClick={onEnter} disabled={starting || !ready}>
          {!ready ? 'Connecting…' : starting ? 'Starting Homework mode…' : 'Enter this week'}
          {ready && !starting && <ChevronRight size={20} />}
        </button>
        {error && <p className="entry-error" role="alert">{error}</p>}
        <p className="entry-note"><ShieldCheck size={14} /> Homework mode begins when you enter</p>
      </section>
    </main>
  )
}

function Sidebar({ view, navigate, rewardCount }: { view: View; navigate: (view: View) => void; rewardCount: number }) {
  const items: { id: View; label: string; icon: typeof Home }[] = [
    { id: 'path', label: 'Home', icon: Home },
    { id: 'options', label: 'Practice', icon: Music2 },
    { id: 'writing', label: 'Writing', icon: BookOpen },
    { id: 'rewards', label: 'Rewards', icon: Gift },
  ]
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('path')} aria-label="Homework Quest home">
        <span className="brand-mark">F</span>
        <span><strong>Homework</strong><small>QUEST</small></span>
      </button>
      <nav className="main-nav" aria-label="Main navigation">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)}>
            <Icon size={20} />
            <span>{label}</span>
            {id === 'rewards' && rewardCount > 0 && <b className="nav-count">{rewardCount}</b>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button className={view === 'parent' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('parent')}>
          <Settings2 size={20} /> <span>Parent</span>
        </button>
        <div className="safe-note"><ShieldCheck size={16} /> Progress saves on this Mac</div>
      </div>
    </aside>
  )
}

function Topbar({ state, serviceStatus }: { state: AppState; serviceStatus: 'connecting' | 'online' | 'offline' }) {
  const completedDays = DAYS.filter((day) => dayIsComplete(state, day)).length
  return (
    <header className="topbar">
      <div>
        <p className="topbar-label">{state.weekContext.headStart ? 'UPCOMING WEEK' : 'WEEK OF'}</p>
        <strong>{getWeekLabel(state.weekContext.weekId)}</strong>
      </div>
      <div className="topbar-actions">
        <span className={serviceStatus === 'online' ? 'connection connected' : 'connection'}>
          <span /> {serviceStatus === 'online' ? 'SQLite connected' : serviceStatus === 'connecting' ? 'Connecting…' : 'Browser backup'}
        </span>
        <div className="week-score"><Trophy size={18} /> {completedDays}/5 days</div>
        <button className="avatar" aria-label="Fionnbar’s profile">F</button>
      </div>
    </header>
  )
}

function PathView({ state, selectedDay, openDay }: { state: AppState; selectedDay: DayName; openDay: (day: DayName) => void }) {
  const optionalTotal = state.optionalCompleted.length
  return (
    <section className="page path-page">
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">YOUR WEEKLY ADVENTURE</p>
          <h2>Pick up where you left off.</h2>
          <p>Complete today’s work, bank practice early, and make your way to Friday Fun.</p>
        </div>
        <div className="bank-card compact">
          <span className="bank-icon"><Star size={20} fill="currentColor" /></span>
          <div><small>WEEKLY PRACTICE</small><strong>{optionalTotal} <span>/ {OPTIONAL_SESSION_TOTAL} banked</span></strong></div>
        </div>
      </div>

      {state.weekContext.headStart && (
        <div className="head-start-note">
          <Sparkles size={20} />
          <div>
            <strong>Sunday Head Start is open.</strong>
            <p>Your full weekly plan stays here on Home. Optional practice completed today counts toward the upcoming week.</p>
          </div>
        </div>
      )}

      <div className="quest-grid">
        <div className="journey-card">
          <div className="journey-line" aria-hidden="true" />
          {DAYS.map((day, index) => {
            const progress = progressForDay(state, day)
            const complete = dayIsComplete(state, day)
            const isToday = day === getToday()
            return (
              <button
                key={day}
                className={`day-stop ${day === 'Friday' ? 'friday' : ''} ${complete ? 'complete' : ''} ${selectedDay === day ? 'selected' : ''}`}
                onClick={() => openDay(day)}
              >
                <span className="day-node">
                  {complete ? <Check size={24} strokeWidth={3} /> : day === 'Friday' ? <Star size={24} fill="currentColor" /> : index + 1}
                </span>
                <span className="day-copy">
                  <span className="day-title-row"><strong>{day === 'Friday' ? 'Friday Fun!' : day}</strong>{isToday && <b>TODAY</b>}</span>
                  <small>{complete ? 'Quest complete!' : `${progress.percent}% complete · ${progress.optional}/${progress.optionalTarget} practice`}</small>
                  <span className="mini-progress"><span style={{ width: `${progress.percent}%` }} /></span>
                </span>
                <ChevronRight size={20} />
              </button>
            )
          })}
        </div>

        <aside className="today-card">
          <div className="today-illustration"><span>✦</span><Trophy size={50} /></div>
          <p className="eyebrow">TODAY’S MOMENTUM</p>
          <h3>{state.optionalCompleted.length >= OPTIONAL_TARGETS[getToday()] ? 'Practice target reached!' : 'You’re building a great week.'}</h3>
          <p>{Math.max(0, OPTIONAL_TARGETS[getToday()] - optionalTotal)} more practice {Math.max(0, OPTIONAL_TARGETS[getToday()] - optionalTotal) === 1 ? 'session' : 'sessions'} to reach today’s banking target.</p>
          <button className="secondary-button" onClick={() => openDay(getToday())}>Open today <ChevronRight size={18} /></button>
          <div className="quote-card">“Small steps are still progress.”</div>
        </aside>
      </div>
    </section>
  )
}

function DayView({
  state,
  day,
  setDay,
  toggleSelfReported,
  startTimer,
  startReadingGame,
  openOptions,
  openPath,
  openRewards,
}: {
  state: AppState
  day: DayName
  setDay: (day: DayName) => void
  toggleSelfReported: (id: string) => void
  startTimer: (timer: ActiveTimer) => void
  startReadingGame: (day: DayName) => void
  openOptions: () => void
  openPath: () => void
  openRewards: () => void
}) {
  const completed = state.requiredByDay[day]
  const progress = progressForDay(state, day)
  const free = dayIsComplete(state, day)
  if (day === 'Friday' && free) {
    return <FridayFunView state={state} setDay={setDay} openPath={openPath} openRewards={openRewards} />
  }
  return (
    <section className="page">
      <div className="day-tabs" role="tablist" aria-label="Choose a weekday">
        {DAYS.map((item) => <button key={item} className={item === day ? 'active' : ''} onClick={() => setDay(item)}>{item.slice(0, 3)}</button>)}
      </div>
      <div className="page-heading split-heading day-heading">
        <div>
          <p className="eyebrow">{day.toUpperCase()}’S QUEST</p>
          <h2>{free ? 'Everything is complete!' : 'One thing at a time.'}</h2>
          <p>{progress.required} of {progress.requiredTotal} daily activities complete.</p>
        </div>
        <div className={free ? 'access-card unlocked' : 'access-card'}>
          {free ? <Sparkles size={22} /> : <LockKeyhole size={22} />}
          <div><small>{free ? 'FREE MODE' : 'HOMEWORK MODE'}</small><strong>{free ? 'Unlocked' : `${progress.percent}% complete`}</strong></div>
        </div>
      </div>

      <div className="section-label"><span>REQUIRED TODAY</span><span>{progress.required}/{progress.requiredTotal}</span></div>
      <div className="activity-list">
        {REQUIRED_ACTIVITIES.map((activity) => {
          const done = completed.includes(activity.id)
          const self = activity.method === 'self'
          const configuration = activity.id === 'ninja-dojo'
            ? state.activityConfiguration.ninjaDojo
            : activity.id === 'du-chinese'
              ? state.activityConfiguration.duChinese
              : activity.id === 'level-chinese'
                ? state.activityConfiguration.levelChinese
                : null
          const needsExternalSetup = Boolean(configuration)
          const externalReady = !configuration || configuration.ready
          const canStartTimer = externalReady
          const gamePending = activity.id === 'reading-strategies' &&
            state.activeGameSession?.day === day &&
            state.activeGameSession.status === 'pending'
          return (
            <article key={activity.id} className={`activity-row ${done ? 'done' : ''} ${activity.method === 'coming-soon' ? 'muted' : ''}`}>
              <div className={`activity-icon icon-${activity.id}`}>{activity.icon}</div>
              <div className="activity-copy">
                <h3>{activity.title}</h3>
                <p>{activity.description}</p>
                <div className="method-label">
                  {self && 'SELF CHECK'}
                  {activity.method === 'timer' && <><Clock3 size={13} /> {activity.minutes} MIN ACTIVE TIME</>}
                  {activity.method === 'verified' && <><ShieldCheck size={13} /> GAME VERIFIED</>}
                  {activity.method === 'coming-soon' && 'COMING SOON'}
                </div>
              </div>
              {self && (
                <button className={`status-check ${done ? 'checked' : ''}`} onClick={() => toggleSelfReported(activity.id)} aria-label={`${done ? 'Mark incomplete' : 'Mark complete'}: ${activity.title}`}>
                  {done ? <Check size={21} strokeWidth={3} /> : <span />}
                </button>
              )}
              {activity.method === 'timer' && !done && (
                <button className="row-button" disabled={!canStartTimer} title={!externalReady ? 'Parent setup is required' : needsExternalSetup && !state.chromeConnected ? 'Managed Chrome is checked when the session starts' : undefined} onClick={() => startTimer({
                  kind: 'required', activityId: activity.id, sessionKey: day, label: activity.title,
                  totalSeconds: (activity.minutes ?? 0) * 60, remainingSeconds: (activity.minutes ?? 0) * 60, running: true,
                })}>{!externalReady ? 'Setup needed' : 'Start'} {canStartTimer && <Play size={15} fill="currentColor" />}</button>
              )}
              {activity.method === 'timer' && done && <span className="verified-check"><Check size={20} /></span>}
              {activity.method === 'verified' && !done && (
                <button className="row-button" onClick={() => startReadingGame(day)}>
                  {gamePending ? 'Continue writing' : 'Start writing'} <Play size={15} fill="currentColor" />
                </button>
              )}
              {activity.method === 'verified' && done && <span className="verified-check"><ShieldCheck size={20} /></span>}
              {activity.method === 'coming-soon' && <span className="soon-pill">Soon</span>}
            </article>
          )
        })}
      </div>

      <button className="practice-banner" onClick={openOptions}>
        <span className="practice-banner-icon"><Music2 size={27} /></span>
        <span><small>WEEKLY PRACTICE BANK</small><strong>{state.optionalCompleted.length} of {OPTIONAL_SESSION_TOTAL} sessions complete</strong></span>
        <span className="banner-progress"><span style={{ width: `${(state.optionalCompleted.length / OPTIONAL_SESSION_TOTAL) * 100}%` }} /></span>
        <ChevronRight />
      </button>
    </section>
  )
}

function FridayFunView({
  state,
  setDay,
  openPath,
  openRewards,
}: {
  state: AppState
  setDay: (day: DayName) => void
  openPath: () => void
  openRewards: () => void
}) {
  const summary = getFridayFunSummary(state)
  return (
    <section className="page friday-fun-page">
      <div className="day-tabs" role="tablist" aria-label="Choose a weekday">
        {DAYS.map((item) => (
          <button key={item} className={item === 'Friday' ? 'active' : ''} onClick={() => setDay(item)}>
            {item.slice(0, 3)}
          </button>
        ))}
      </div>

      <div className="friday-hero">
        <div className="friday-sparkles" aria-hidden="true"><span>✦</span><span>★</span><span>✦</span></div>
        <div className="friday-trophy"><Trophy size={58} strokeWidth={1.8} /></div>
        <p className="eyebrow">FRIDAY FUN!</p>
        <h2>You finished the quest.</h2>
        <p>Friday’s work is complete, all {OPTIONAL_SESSION_TOTAL} practice sessions are banked, and Free Mode is unlocked.</p>
        <div className="friday-actions">
          <button className="secondary-button" onClick={openPath}><ArrowLeft size={17} /> See the week</button>
          <button className="primary-button" onClick={openRewards}>View saved rewards <Gift size={17} /></button>
        </div>
      </div>

      <div className="friday-summary" aria-label="Weekly achievement summary">
        <article><span className="summary-icon"><Check size={23} /></span><small>DAILY ACTIVITIES</small><strong>{summary.requiredCompleted}<em>/{summary.requiredTotal}</em></strong><p>completed this week</p></article>
        <article><span className="summary-icon"><Music2 size={23} /></span><small>PRACTICE BANK</small><strong>{summary.optionalCompleted}<em>/{summary.optionalTotal}</em></strong><p>sessions completed</p></article>
        <article><span className="summary-icon"><BookOpen size={23} /></span><small>WRITING</small><strong>{summary.writingDrafts}</strong><p>{summary.writingWords} {summary.writingWords === 1 ? 'word' : 'words'} saved</p></article>
        <article><span className="summary-icon"><Gift size={23} /></span><small>REWARDS EARNED</small><strong>{summary.rewardsEarned}</strong><p>{summary.rewardsAvailable} still available</p></article>
      </div>

      <div className="friday-days">
        <div className="section-label"><span>YOUR WEEK AT A GLANCE</span><span>{summary.days.filter((day) => day.questComplete).length}/5 QUESTS</span></div>
        <div className="friday-day-grid">
          {summary.days.map((day) => (
            <button key={day.day} className={day.questComplete ? 'complete' : ''} onClick={() => setDay(day.day)}>
              <span>{day.questComplete ? <Check size={18} strokeWidth={3} /> : day.day.slice(0, 1)}</span>
              <strong>{day.day}</strong>
              <small>{day.completed}/{day.total} daily</small>
            </button>
          ))}
        </div>
      </div>

      <div className="free-mode-note">
        <Sparkles size={22} />
        <div><strong>Free Mode is ready.</strong><p>This celebration records the unlock only. It does not add screen time or create extra reward credits.</p></div>
      </div>
    </section>
  )
}

function OptionalView({
  state,
  startTimer,
  onBack,
  headStart = false,
}: {
  state: AppState
  startTimer: (timer: ActiveTimer) => void
  onBack?: () => void
  headStart?: boolean
}) {
  return (
    <section className={headStart ? 'page head-start-page' : 'page'}>
      {!headStart && onBack && <button className="text-button back-button" onClick={onBack}><ArrowLeft size={17} /> Back to week</button>}
      {headStart && (
        <div className="head-start-note">
          <span><Sparkles size={22} /></span>
          <div><small>SUNDAY · AFTER 4:00 A.M.</small><strong>Your upcoming practice bank is open.</strong><p>Only optional practice is available today. Everything you finish counts toward next week.</p></div>
        </div>
      )}
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">{headStart ? 'GET A HEAD START' : 'PRACTICE BANK'}</p>
          <h2>{headStart ? 'Build momentum for Monday.' : 'Choose your next session.'}</h2>
          <p>{headStart ? `These sessions are banked for the week of ${getWeekLabel(state.weekContext.weekId)}.` : 'Finish sessions early and they count toward the whole week.'}</p>
        </div>
        <div className="big-score"><strong>{state.optionalCompleted.length}</strong><span>of {OPTIONAL_SESSION_TOTAL}<br />banked</span></div>
      </div>
      <div className="practice-grid">
        {OPTIONAL_ACTIVITIES.map((activity) => {
          const completedCount = Array.from({ length: activity.sessions }).filter((_, index) => state.optionalCompleted.includes(optionalSessionKey(activity.id, index))).length
          return (
            <article className={`practice-card practice-${activity.id}`} key={activity.id}>
              <div className="practice-top"><span className="large-activity-icon">{activity.icon}</span><span className="duration"><Clock3 size={14} /> {activity.minutes} min</span></div>
              <h3>{activity.title}</h3>
              <p>{activity.detail}</p>
              <div className="segments" aria-label={`${completedCount} of ${activity.sessions} sessions complete`}>
                {Array.from({ length: activity.sessions }).map((_, index) => {
                  const key = optionalSessionKey(activity.id, index)
                  const done = state.optionalCompleted.includes(key)
                  return (
                    <button key={key} className={done ? 'segment done' : 'segment'} disabled={done} onClick={() => startTimer({
                      kind: 'optional', activityId: activity.id, sessionKey: key,
                      label: `${activity.title} · Session ${index + 1}`,
                      totalSeconds: activity.minutes * 60, remainingSeconds: activity.minutes * 60, running: true,
                    })}>
                      {done ? <Check size={17} /> : <span>{index + 1}</span>}
                    </button>
                  )
                })}
              </div>
              <small className="card-foot">{completedCount === activity.sessions ? 'All sessions banked' : `${activity.sessions - completedCount} left this week`}</small>
            </article>
          )
        })}
      </div>
      <div className="head-start-note"><Sparkles size={20} /><div><strong>Get a Head Start</strong><p>The next practice week opens every Sunday at 4:00 a.m.</p></div></div>
    </section>
  )
}

function WritingAccuracyGraph({ points }: { points: number[] }) {
  if (!points.length) return null
  const width = 320
  const height = 120
  const inset = 16
  const coordinates = points.map((percent, index) => {
    const x = points.length === 1
      ? width / 2
      : inset + (index / (points.length - 1)) * (width - inset * 2)
    const y = inset + ((100 - percent) / 100) * (height - inset * 2)
    return { x, y, percent }
  })
  return (
    <figure className="accuracy-graph">
      <figcaption>First-try accuracy after each question</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Line graph of cumulative first-try accuracy across ${points.length} questions, ending at ${points.at(-1)} percent`}>
        <title>Cumulative first-try writing-game accuracy</title>
        <line x1={inset} y1={inset} x2={inset} y2={height - inset} />
        <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} />
        <line className="guide" x1={inset} y1={height / 2} x2={width - inset} y2={height / 2} />
        <polyline points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')} />
        {coordinates.map(({ x, y, percent }, index) => <circle key={`${index}-${percent}`} cx={x} cy={y} r="4"><title>{`Question ${index + 1}: ${percent}% cumulative first-try accuracy`}</title></circle>)}
      </svg>
      <span><b>0%</b><b>50%</b><b>100%</b></span>
    </figure>
  )
}

function HighlightedSentence({
  text,
  ranges,
}: {
  text: string
  ranges: Array<{ start: number; end: number }>
}) {
  const pieces: React.ReactNode[] = []
  let cursor = 0
  for (const [index, range] of ranges.entries()) {
    const start = Math.max(cursor, Math.min(text.length, range.start))
    const end = Math.max(start, Math.min(text.length, range.end))
    if (start > cursor) pieces.push(text.slice(cursor, start))
    if (end > start) pieces.push(<mark key={`${start}-${end}-${index}`}>{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) pieces.push(text.slice(cursor))
  return <>{pieces}</>
}

function dateInputValueForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function WritingView({
  state,
  setState,
  serviceStatus,
  finishWritingGame,
}: {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  serviceStatus: 'connecting' | 'online' | 'offline'
  finishWritingGame: (draftId: string) => Promise<void>
}) {
  const dailyWritingActive = state.activeGameSession?.status === 'pending'
  const writingDay = state.activeGameSession?.status === 'pending'
    ? state.activeGameSession.day
    : state.weekContext.localDay
  const currentWritingKey = writingActivityKey(
    state.weekContext.weekId,
    writingDay,
  )
  const workingDraft = state.drafts.find((draft) =>
    (!draft.weekId || draft.weekId === state.weekContext.weekId) &&
    draftBelongsToWritingActivity(draft, currentWritingKey),
  )
  const automaticBlankDraftId = useRef(crypto.randomUUID())
  const newDraftReadingDate = dateInputValueForTimeZone(new Date(), state.weekContext.timeZone)
  const [readingDate, setReadingDate] = useState(workingDraft?.readingDate ?? newDraftReadingDate)
  const [title, setTitle] = useState(workingDraft?.title ?? '')
  const [author, setAuthor] = useState(workingDraft?.author ?? '')
  const [pagesRead, setPagesRead] = useState(workingDraft?.pagesRead ?? '')
  const [body, setBody] = useState(workingDraft?.body ?? '')
  const [showReview, setShowReview] = useState(Boolean(
    workingDraft?.body.trim() && (
      workingDraft.reviewStatus !== 'complete' ||
      (dailyWritingActive && (workingDraft.findings?.length ?? 0) === 0)
    ),
  ))
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(workingDraft?.id ?? null)
  const [revisingFromDraftId, setRevisingFromDraftId] = useState<string | null>(
    workingDraft?.reviewStatus === 'complete' && (workingDraft.findings?.length ?? 0) > 0
      ? workingDraft.id
      : null,
  )
  const [answerMessage, setAnswerMessage] = useState('')
  const [answerState, setAnswerState] = useState<WritingAnswerState | null>(null)
  const [spellingAnswer, setSpellingAnswer] = useState('')
  const [finishingWriting, setFinishingWriting] = useState(false)
  const [finishMessage, setFinishMessage] = useState('')
  const [checkingWriting, setCheckingWriting] = useState(false)
  const [proofreadingMessage, setProofreadingMessage] = useState('')
  const [meaningReviewBusy, setMeaningReviewBusy] = useState(false)
  const [meaningReviewMessage, setMeaningReviewMessage] = useState('')
  const [writingLog, setWritingLog] = useState<WritingLogState | null>(null)
  const [writingLogMessage, setWritingLogMessage] = useState('')
  const [writingLogBusy, setWritingLogBusy] = useState(false)
  const questionHeadingRef = useRef<HTMLHeadingElement>(null)
  const analysis = useMemo(() => ({
    findings: inspectWritingFindings(body, state.writingDictionary),
    reviewItems: inspectAmbiguousDraft(body),
    spellingWords: [],
  }), [body, state.writingDictionary])
  const findings = analysis.findings
  const reviewDraft = state.drafts.find((draft) => draft.id === reviewDraftId)
  const sentenceReviews = reviewDraft?.sentenceReviews ?? []
  const pendingSentenceReview = sentenceReviews.find((review) => !review.selectedOptionId)
  const reviewFindings = reviewDraft?.findings ?? findings
  const reviewProgress = reviewDraft?.exerciseProgress ?? {}
  const legacySpellingNeedsAnalysis = reviewDraft?.reviewStatus === 'spelling-pending' &&
    (reviewDraft.spellingWords?.length ?? 0) === 0
  const reviewSpellingWords = legacySpellingNeedsAnalysis && reviewDraft
    ? inspectSpelling(reviewDraft.body, state.writingDictionary)
    : reviewDraft?.spellingWords ?? analysis.spellingWords
  const reviewSpellingProgress = reviewDraft?.spellingProgress ?? {}
  const pendingReviewCount = reviewDraft
    ? state.writingReviewQueue.filter((item) => item.draftId === reviewDraft.id && item.status === 'pending').length
    : 0
  const activeFinding = reviewFindings.find((finding) => {
    const progress = reviewProgress[finding.id]
    return !progress?.correctionComplete || progress.practiceCompleted < finding.practice.length
  })
  const activeProgress = activeFinding
    ? reviewProgress[activeFinding.id] ?? { correctionComplete: false, practiceCompleted: 0, incorrectAttempts: 0 }
    : null
  const activeTrial = activeFinding && activeProgress
    ? activeProgress.correctionComplete
      ? activeFinding.practice[activeProgress.practiceCompleted]
      : activeFinding.correction
    : null
  const activeSpellingStep = activeFinding ? null : nextSpellingStep(reviewSpellingWords, reviewSpellingProgress)
  const activeSpellingWord = activeSpellingStep
    ? reviewSpellingWords.find((word) => word.id === activeSpellingStep.wordId)
    : null
  const totalExerciseSteps = reviewFindings.reduce((total, finding) => total + finding.practice.length + 1, 0)
  const completedExerciseSteps = reviewFindings.reduce((total, finding) => {
    const progress = reviewProgress[finding.id]
    return total + (progress?.correctionComplete ? 1 : 0) +
      Math.min(finding.practice.length, progress?.practiceCompleted ?? 0)
  }, 0)
  const totalSpellingSteps = reviewSpellingWords.length * 9
  const spellingStepsComplete = completedSpellingSteps(reviewSpellingWords, reviewSpellingProgress)
  const writingScore = scoreWritingResponses(reviewFindings, reviewProgress)
  const reviewAreas = [
    { name: 'Grammar', label: 'Agreement, articles, and basic tense' },
    { name: 'Capitalization', label: 'Sentence starts and known names' },
    { name: 'Punctuation', label: 'Sentence breaks, commas, and quotations' },
    { name: 'Spelling', label: 'Reviewed or context-verified spelling' },
  ] as const

  const writingLogFingerprint = state.drafts
    .map((draft) => `${draft.id}:${draft.updatedAt}`)
    .join('|')

  useEffect(() => {
    if (workingDraft) return
    const id = automaticBlankDraftId.current
    const blankDraft: Draft = {
      id,
      weekId: state.weekContext.weekId,
      activityKey: currentWritingKey,
      revisionGroupId: id,
      versionNumber: 1,
      readingDate: newDraftReadingDate,
      title: '',
      author: '',
      pagesRead: '',
      body: '',
      correctedBody: '',
      updatedAt: new Date().toISOString(),
      findings: [],
      proofreadingMatches: [],
      reviewSuggestions: [],
      sentenceReviews: [],
      exerciseProgress: {},
      spellingWords: [],
      spellingProgress: {},
      reviewStatus: 'draft',
    }
    setState((current) => ({
      ...current,
      drafts: current.drafts.some((draft) =>
        (!draft.weekId || draft.weekId === state.weekContext.weekId) &&
        draftBelongsToWritingActivity(draft, currentWritingKey))
        ? current.drafts
        : [blankDraft, ...current.drafts.filter((draft) => draft.body.trim())],
    }))
    setReviewDraftId(id)
  }, [currentWritingKey, newDraftReadingDate, setState, state.weekContext.weekId, workingDraft])

  useEffect(() => {
    if (serviceStatus !== 'online') return
    let cancelled = false
    const refresh = () => {
      getWritingLogStatus()
        .then((response) => {
          if (!cancelled) setWritingLog(response.writingLog)
        })
        .catch(() => {
          if (!cancelled) setWritingLog(null)
        })
    }
    void refresh()
    const interval = window.setInterval(refresh, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [serviceStatus, writingLogFingerprint])

  const syncWritingLogNow = async () => {
    setWritingLogBusy(true)
    setWritingLogMessage('')
    try {
      await saveStateToService(state)
      const response = await syncWritingLog()
      setWritingLog(response.writingLog)
      setWritingLogMessage('The writing log is up to date. Newest entries are at the top.')
    } catch (error) {
      setWritingLogMessage(error instanceof Error ? error.message : 'The writing log could not be updated.')
    } finally {
      setWritingLogBusy(false)
    }
  }

  useEffect(() => {
    setAnswerMessage('')
    setAnswerState(null)
    setSpellingAnswer('')
    if (activeTrial) window.requestAnimationFrame(() => questionHeadingRef.current?.focus())
  }, [activeTrial?.id, activeSpellingStep?.wordId, activeSpellingStep?.phase, activeSpellingStep?.attempt])

  useEffect(() => {
    if (!showReview || !reviewDraft || !legacySpellingNeedsAnalysis) return
    const migratedStatus = writingReviewStatus(
      reviewFindings,
      reviewProgress,
      reviewSpellingWords,
      reviewSpellingProgress,
    )
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.id === reviewDraft.id
        ? { ...draft, spellingWords: reviewSpellingWords, spellingProgress: {}, reviewStatus: migratedStatus }
        : draft),
    }))
  }, [
    legacySpellingNeedsAnalysis,
    reviewDraft,
    reviewFindings,
    reviewProgress,
    reviewSpellingProgress,
    reviewSpellingWords,
    setState,
    showReview,
  ])

  const save = async () => {
    if (!title.trim() && !body.trim()) return
    const submittedBody = body
    setCheckingWriting(true)
    setProofreadingMessage('Checking spelling, grammar, capitalization, and punctuation… AI checks the passage twice; this may take a few minutes.')
    try {
      const proofreading = await proofreadWriting(submittedBody)
      const checkedFindings = inspectWritingFindings(
        submittedBody,
        state.writingDictionary,
        proofreading.matches,
        { authoritative: proofreading.authoritative },
      )
      const revisionSource = revisingFromDraftId
        ? state.drafts.find((draft) => draft.id === revisingFromDraftId)
        : undefined
      const existingDraft = !revisionSource
        ? reviewDraft ?? (workingDraft?.reviewStatus !== 'complete' ? workingDraft : undefined)
        : undefined
      const draftId = existingDraft?.id ?? crypto.randomUUID()
      const revisionGroupId = revisionSource?.revisionGroupId ?? revisionSource?.id ??
        existingDraft?.revisionGroupId ?? existingDraft?.id ?? draftId
      const versionNumber = revisionSource
        ? (revisionSource.versionNumber ?? 1) + 1
        : existingDraft?.versionNumber ?? 1
      const sentenceReviews = proofreading.sentenceReviews ?? []
      const reviewSuggestions = [
        ...(proofreading.authoritative ? [] : analysis.reviewItems),
        ...proofreading.reviewItems,
      ]
      const draft: Draft = {
        id: draftId,
        weekId: state.weekContext.weekId,
        activityKey: currentWritingKey,
        revisionGroupId,
        versionNumber,
        readingDate,
        title: title.trim() || 'Untitled writing',
        author: author.trim(),
        pagesRead: pagesRead.trim(),
        body: submittedBody,
        correctedBody: submittedBody,
        updatedAt: new Date().toISOString(),
        findings: checkedFindings,
        proofreadingMatches: proofreading.matches,
        proofreadingAuthoritative: proofreading.authoritative,
        proofreadingCheckId: proofreading.checkId,
        reviewSuggestions,
        sentenceReviews,
        exerciseProgress: {},
        spellingWords: analysis.spellingWords,
        spellingProgress: {},
        reviewStatus: sentenceReviews.length > 0
          ? 'intent-review'
          : writingReviewStatus(
              checkedFindings,
              {},
              analysis.spellingWords,
              {},
              reviewSuggestions.length,
            ),
      }
      const createdAt = new Date().toISOString()
      setState((current) => {
        const existing = new Map(current.writingReviewQueue.map((item) => [item.id, item]))
        const reviewItems = reviewSuggestions.map((item) => {
          const id = `${draft.id}:${item.id}`
          return (existingDraft?.proofreadingCheckId === draft.proofreadingCheckId ? existing.get(id) : undefined) ?? {
            ...item,
            id,
            draftId: draft.id,
            status: 'pending' as const,
            createdAt,
          }
        })
        return {
          ...current,
          drafts: [draft, ...current.drafts.filter((item) => item.id !== draft.id)],
          writingReviewQueue: [
            ...current.writingReviewQueue.filter((item) => item.draftId !== draft.id),
            ...reviewItems,
          ],
        }
      })
      const localMessage = proofreading.available
        ? `${proofreading.engine} checked this version.`
        : 'The professional proofreader was unavailable, so reviewed offline rules were used.'
      const aiMessage = proofreading.incomplete
        ? ' The full check is incomplete. Valid corrections were kept, but this version still needs another check or Parent review.'
        : proofreading.ai.analyzed
        ? proofreading.ai.mode === 'shadow'
          ? ` AI shadow review checked ${proofreading.ai.counts.total} possible ${proofreading.ai.counts.total === 1 ? 'issue' : 'issues'} without showing or applying them.`
          : proofreading.ai.mode === 'review'
            ? ` AI sent ${proofreading.ai.counts.review} ${proofreading.ai.counts.review === 1 ? 'suggestion' : 'suggestions'} to Parent review.`
            : ` AI added ${proofreading.ai.counts.practice} high-confidence ${proofreading.ai.counts.practice === 1 ? 'correction' : 'corrections'} and sent ${proofreading.ai.counts.review} to Parent review.`
        : proofreading.ai.mode !== 'off' && proofreading.ai.error
          ? ' AI review was unavailable; the local checks still completed.'
          : ' AI proofreading is off. Only supported local rules and parent-reviewed suggestions are available.'
      const meaningMessage = sentenceReviews.length > 0
        ? ` Start with ${sentenceReviews.length} sentence meaning ${sentenceReviews.length === 1 ? 'check' : 'checks'} before the correction game.`
        : proofreading.intentAi?.mode !== 'off' && proofreading.intentAi?.error
          ? ' AI meaning review was unavailable, so only verified corrections are shown.'
          : ''
      setProofreadingMessage(`${localMessage}${aiMessage}${meaningMessage}`)
      setReviewDraftId(draft.id)
      setRevisingFromDraftId(null)
      setShowReview(true)
    } catch (error) {
      setProofreadingMessage(`The writing check did not finish. Your text is still in the editor; please check it again. ${error instanceof Error ? error.message : ''}`)
    } finally {
      setCheckingWriting(false)
    }
  }

  const beginRevision = () => {
    if (!reviewDraft) return
    setReadingDate(reviewDraft.readingDate ?? newDraftReadingDate)
    setTitle(reviewDraft.title)
    setAuthor(reviewDraft.author ?? '')
    setPagesRead(reviewDraft.pagesRead ?? '')
    setBody(reviewDraft.body)
    setRevisingFromDraftId(reviewDraft.id)
    setReviewDraftId(null)
    setFinishMessage('')
    setProofreadingMessage('')
    setShowReview(false)
  }

  const prepareRecheck = () => {
    if (!reviewDraft || checkingWriting) return
    setReadingDate(reviewDraft.readingDate ?? newDraftReadingDate)
    setTitle(reviewDraft.title)
    setAuthor(reviewDraft.author ?? '')
    setPagesRead(reviewDraft.pagesRead ?? '')
    setBody(reviewDraft.body)
    setRevisingFromDraftId(null)
    setShowReview(false)
    setAnswerMessage('')
    setAnswerState(null)
    setProofreadingMessage('Your original writing is ready to recheck. Save & check to replace this version’s old corrections and restart its correction game.')
  }

  const startFreshDraft = () => {
    const id = crypto.randomUUID()
    const blankDraft: Draft = {
      id,
      weekId: state.weekContext.weekId,
      activityKey: currentWritingKey,
      revisionGroupId: id,
      versionNumber: 1,
      readingDate: newDraftReadingDate,
      title: '',
      author: '',
      pagesRead: '',
      body: '',
      correctedBody: '',
      updatedAt: new Date().toISOString(),
      findings: [],
      proofreadingMatches: [],
      reviewSuggestions: [],
      sentenceReviews: [],
      exerciseProgress: {},
      spellingWords: [],
      spellingProgress: {},
      reviewStatus: 'draft',
    }
    setState((current) => ({
      ...current,
      drafts: [blankDraft, ...current.drafts.filter((draft) => draft.body.trim())],
    }))
    setReadingDate(newDraftReadingDate)
    setTitle('')
    setAuthor('')
    setPagesRead('')
    setBody('')
    setReviewDraftId(id)
    setRevisingFromDraftId(null)
    setAnswerMessage('')
    setAnswerState(null)
    setSpellingAnswer('')
    setFinishMessage('')
    setProofreadingMessage('')
    setShowReview(false)
  }

  const chooseSentenceMeaning = (review: SentenceMeaningReview, optionId: string) => {
    if (!reviewDraft || meaningReviewBusy) return
    const option = review.options.find((candidate) => candidate.id === optionId)
    if (!option) return
    const nextReviews = sentenceReviews.map((item) => item.id === review.id
      ? { ...item, selectedOptionId: option.id, selectedText: option.text }
      : item)
    const allMeaningsConfirmed = nextReviews.every((item) => item.selectedOptionId)
    const intentMatches = selectedMeaningMatches(nextReviews)
    const baseMatches = (reviewDraft.proofreadingMatches ?? []).filter(
      (match) => !match.ruleId.startsWith('AI_CONFIRMED_MEANING_'),
    )
    const proofreadingMatches = allMeaningsConfirmed
      ? [...intentMatches, ...baseMatches]
      : baseMatches
    const nextFindings = allMeaningsConfirmed
      ? inspectWritingFindings(reviewDraft.body, state.writingDictionary, proofreadingMatches, { authoritative: reviewDraft.proofreadingAuthoritative })
      : reviewFindings
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.id === reviewDraft.id
        ? {
            ...draft,
            sentenceReviews: nextReviews,
            findings: nextFindings,
            proofreadingMatches,
            exerciseProgress: allMeaningsConfirmed ? {} : draft.exerciseProgress,
            correctedBody: draft.body,
            reviewStatus: allMeaningsConfirmed
              ? writingReviewStatus(
                  nextFindings,
                  {},
                  reviewSpellingWords,
                  {},
                  pendingReviewCount,
                )
              : 'intent-review',
            updatedAt: new Date().toISOString(),
          }
        : draft),
    }))
    setMeaningReviewMessage(allMeaningsConfirmed
      ? 'Meaning confirmed. Now fix one highlighted error at a time.'
      : 'Got it. Check the next sentence.')
  }

  const tryDifferentMeanings = async (review: SentenceMeaningReview) => {
    if (!reviewDraft || meaningReviewBusy) return
    const rejectedOptions = [
      ...(review.rejectedOptions ?? []),
      ...review.options.map((option) => option.text),
    ]
    setMeaningReviewBusy(true)
    setMeaningReviewMessage('Thinking of three different possibilities…')
    try {
      const response = await retrySentenceMeaning(reviewDraft.body, { ...review, rejectedOptions })
      if (!response.review) throw new Error(response.intentAi.error || 'No different meanings were returned. Ask a parent to help with this sentence.')
      setState((current) => ({
        ...current,
        drafts: current.drafts.map((draft) => draft.id === reviewDraft.id
          ? {
              ...draft,
              sentenceReviews: (draft.sentenceReviews ?? []).map((item) => item.id === review.id
                ? { ...response.review!, rejectedOptions }
                : item),
              updatedAt: new Date().toISOString(),
            }
          : draft),
      }))
      setMeaningReviewMessage('Here are three different possibilities.')
    } catch (error) {
      setMeaningReviewMessage(error instanceof Error ? error.message : 'Different meaning choices could not be generated.')
    } finally {
      setMeaningReviewBusy(false)
    }
  }

  const chooseAnswer = (choice: string) => {
    if (!activeTrial || answerState?.resolved) return
    setAnswerState((current) => resolveWritingChoice(activeTrial, choice, current))
  }

  const continueAfterAnswer = () => {
    if (!reviewDraft || !activeFinding || !activeProgress || !activeTrial) return
    if (!answerState?.resolved) return
    const nextItem = advanceFindingProgress(
      activeProgress,
      answerState.firstAttemptCorrect,
      activeFinding.practice.length,
    )
    const nextProgress = { ...reviewProgress, [activeFinding.id]: nextItem }
    const grammarCorrected = applyCompletedCorrections(reviewDraft.body, reviewFindings, nextProgress)
    const correctedBody = applyCompletedSpellingCorrections(
      grammarCorrected,
      reviewSpellingWords,
      reviewSpellingProgress,
    )
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.id === reviewDraft.id
        ? {
            ...draft,
            correctedBody,
            exerciseProgress: nextProgress,
            spellingWords: reviewSpellingWords,
            spellingProgress: reviewSpellingProgress,
            reviewStatus: writingReviewStatus(
              reviewFindings,
              nextProgress,
              reviewSpellingWords,
              reviewSpellingProgress,
              pendingReviewCount,
            ),
            updatedAt: new Date().toISOString(),
          }
        : draft),
    }))
    setAnswerState(null)
  }

  const skipCorrectionGame = () => {
    if (!reviewDraft || reviewFindings.length === 0) return
    const skippedProgress = skipRemainingWritingTrials(reviewFindings, reviewProgress)
    const correctedBody = applyCompletedCorrections(reviewDraft.body, reviewFindings, skippedProgress)
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.id === reviewDraft.id
        ? {
            ...draft,
            correctedBody,
            exerciseProgress: skippedProgress,
            spellingWords: [],
            spellingProgress: {},
            reviewStatus: pendingReviewCount > 0 ? 'awaiting-review' : 'complete',
            updatedAt: new Date().toISOString(),
          }
        : draft),
    }))
    setAnswerState(null)
    setAnswerMessage('')
  }

  const speakSpellingWord = () => {
    if (!activeSpellingWord || !('speechSynthesis' in window)) {
      setAnswerMessage('Speech is unavailable on this Mac. Ask a parent to read the word aloud.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(activeSpellingWord.correctWord)
    utterance.rate = 0.78
    window.speechSynthesis.speak(utterance)
  }

  const submitSpelling = (event: React.FormEvent) => {
    event.preventDefault()
    if (!reviewDraft || !activeSpellingStep || !activeSpellingWord || !spellingAnswer.trim()) return
    const result = submitSpellingAnswer(
      reviewSpellingWords,
      reviewSpellingProgress,
      activeSpellingStep,
      spellingAnswer,
    )
    const grammarCorrected = applyCompletedCorrections(reviewDraft.body, reviewFindings, reviewProgress)
    const correctedBody = applyCompletedSpellingCorrections(
      grammarCorrected,
      reviewSpellingWords,
      result.progress,
    )
    setState((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.id === reviewDraft.id
        ? {
            ...draft,
            correctedBody,
            spellingWords: reviewSpellingWords,
            spellingProgress: result.progress,
            reviewStatus: writingReviewStatus(
              reviewFindings,
              reviewProgress,
              reviewSpellingWords,
              result.progress,
              pendingReviewCount,
            ),
            updatedAt: new Date().toISOString(),
          }
        : draft),
    }))
    setAnswerMessage(result.correct ? 'Correct! That spelling response counts.' : 'Try again. Listen once more—the counter did not advance.')
    if (result.correct) setSpellingAnswer('')
  }

  const finishDailyWriting = async () => {
    if (!reviewDraft || !dailyWritingActive) return
    setFinishingWriting(true)
    setFinishMessage('')
    try {
      await finishWritingGame(reviewDraft.id)
    } catch (error) {
      setFinishMessage(error instanceof Error ? error.message : 'The daily writing activity could not be completed.')
    } finally {
      setFinishingWriting(false)
    }
  }

  return (
    <section className="page writing-page">
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">{dailyWritingActive ? 'DAILY READING RESPONSE' : 'WRITING STUDIO'}</p>
          <h2>{dailyWritingActive ? 'Read, write, practice, edit.' : 'Make your ideas clear.'}</h2>
          <p>{dailyWritingActive ? 'Choose any passage to read, then write what you understood or thought about it. Your original words are saved before review.' : 'Your original words are always saved before review.'}</p>
        </div>
        <div className="privacy-pill"><ShieldCheck size={18} /><span><strong>Local-first checks</strong><small>Parent controls any AI review</small></span></div>
      </div>
      <div className={`writing-grid${showReview ? ' game-open' : ''}`}>
        <div className="editor-card">
          <div className="reading-details" aria-label="Reading details">
            <label className="reading-detail book-title-field">
              <span>Book title</span>
              <input
                className="title-input"
                value={title}
                disabled={showReview || checkingWriting}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What book did you read?"
                maxLength={200}
                spellCheck
              />
            </label>
            <label className="reading-detail">
              <span>Author</span>
              <input
                value={author}
                disabled={showReview || checkingWriting}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="Author's name"
                maxLength={160}
                spellCheck
              />
            </label>
            <label className="reading-detail">
              <span>Date</span>
              <input
                type="date"
                value={readingDate}
                disabled={showReview || checkingWriting}
                onChange={(event) => setReadingDate(event.target.value)}
              />
            </label>
            <label className="reading-detail">
              <span>Pages read</span>
              <input
                value={pagesRead}
                disabled={showReview || checkingWriting}
                onChange={(event) => setPagesRead(event.target.value)}
                placeholder="e.g. 34–52"
                maxLength={80}
              />
            </label>
          </div>
          <textarea
            value={body}
            disabled={showReview || checkingWriting}
            onChange={(event) => setBody(event.target.value)}
            placeholder={dailyWritingActive ? 'What happened in the passage? What did you learn, notice, or think about?' : 'Start writing here…'}
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            aria-label="Writing draft"
          />
          <div className="editor-footer"><span>{body.trim() ? body.trim().split(/\s+/).length : 0} words</span><span>Drafts are saved on this Mac · Enabled AI review sends the passage to OpenAI</span></div>
        </div>
        <aside className="review-card" role={showReview ? 'dialog' : undefined} aria-modal={showReview || undefined} aria-label={showReview ? 'Correction game' : undefined}>
          <div className="review-heading"><span className="review-icon"><Sparkles size={20} /></span><div><h3>{showReview ? 'Correction game' : 'Ready to review?'}</h3><p>{showReview ? `Version ${reviewDraft?.versionNumber ?? 1} · complete the game, then revise` : 'We’ll look for rules we know well.'}</p></div>{showReview && <button className="text-button review-reset-button" type="button" onClick={startFreshDraft}>Start new draft</button>}</div>
          {showReview && reviewDraft && (
            <dl className="reading-details-summary">
              <div><dt>Book</dt><dd>{reviewDraft.title || 'Untitled writing'}</dd></div>
              {reviewDraft.author && <div><dt>Author</dt><dd>{reviewDraft.author}</dd></div>}
              {reviewDraft.readingDate && <div><dt>Date</dt><dd>{reviewDraft.readingDate}</dd></div>}
              {reviewDraft.pagesRead && <div><dt>Pages</dt><dd>{reviewDraft.pagesRead}</dd></div>}
            </dl>
          )}
          {proofreadingMessage && <p className="proofreading-status" role="status">{proofreadingMessage}</p>}
          {showReview && <button className="text-button" type="button" disabled={checkingWriting || meaningReviewBusy} onClick={prepareRecheck}>Recheck this draft</button>}
          {!showReview ? (
            <div className="review-empty">
              {revisingFromDraftId && <div className="revision-callout"><strong>Revise version {state.drafts.find((draft) => draft.id === revisingFromDraftId)?.versionNumber ?? 1}</strong><span>Correct the errors you practiced, then check the new version.</span></div>}
              <div className="review-category"><span>✓</span><p><strong>Grammar</strong><small>Agreement, articles, and basic tense</small></p></div>
              <div className="review-category"><span>ABC</span><p><strong>Capitalization</strong><small>Sentence starts and known names</small></p></div>
              <div className="review-category"><span>.,?</span><p><strong>Punctuation</strong><small>Sentence breaks, commas, and quotations</small></p></div>
              <div className="review-category"><span>ABC</span><p><strong>Spelling</strong><small>Local professional dictionary and reviewed context</small></p></div>
              <button className="primary-button full-button" disabled={!body.trim() || checkingWriting} onClick={save}>{checkingWriting ? 'Checking writing…' : revisingFromDraftId ? 'Save revision & check again' : dailyWritingActive ? 'Save & open correction game' : 'Save & check my writing'}</button>
            </div>
          ) : pendingSentenceReview ? (
            <div className="meaning-review">
              <div className="exercise-progress">
                <span>Meaning check {sentenceReviews.filter((review) => review.selectedOptionId).length + 1} of {sentenceReviews.length}</span>
                <div><i style={{ width: `${sentenceReviews.length ? (sentenceReviews.filter((review) => review.selectedOptionId).length / sentenceReviews.length) * 100 : 0}%` }} /></div>
              </div>
              <small className="exercise-category">SELF REVIEW · YELLOW PARTS MAY NEED HELP</small>
              <h4>What were you trying to say?</h4>
              <p className="meaning-review-help">Read the whole sentence. The app highlighted every part it is unsure about.</p>
              <blockquote className="highlighted-sentence">
                <HighlightedSentence text={pendingSentenceReview.original} ranges={pendingSentenceReview.highlights} />
              </blockquote>
              <div className="meaning-choices" role="radiogroup" aria-label="Choose what you meant">
                {pendingSentenceReview.options.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={meaningReviewBusy}
                    onClick={() => chooseSentenceMeaning(pendingSentenceReview, option.id)}
                  >
                    <b>{index + 1}</b><span>{option.text}</span>
                  </button>
                ))}
                <button
                  className="none-choice"
                  type="button"
                  disabled={meaningReviewBusy}
                  onClick={() => { void tryDifferentMeanings(pendingSentenceReview) }}
                >
                  <b>4</b><span>None of these — try different ideas</span>
                </button>
              </div>
              {meaningReviewMessage && <p className="meaning-review-message" role="status">{meaningReviewMessage}</p>}
            </div>
          ) : activeFinding && activeTrial ? (
            <div className="writing-exercise">
              <div className="exercise-progress">
                <span>{completedExerciseSteps} of {totalExerciseSteps} steps</span>
                <div><i style={{ width: `${totalExerciseSteps ? (completedExerciseSteps / totalExerciseSteps) * 100 : 100}%` }} /></div>
              </div>
              {import.meta.env.DEV && <button className="skip-game-button" type="button" onClick={skipCorrectionGame}>Skip game for testing</button>}
              {!activeProgress?.correctionComplete && activeTrial.focus && (
                <div className="isolated-error">
                  <small>Error {reviewFindings.indexOf(activeFinding) + 1} of {reviewFindings.length}</small>
                  <p><HighlightedSentence text={activeTrial.focus.text} ranges={[{ start: activeTrial.focus.start, end: activeTrial.focus.end }]} /></p>
                  <span>Only the yellow part needs attention. The rest of this sentence is already correct.</span>
                </div>
              )}
              <div className="exercise-area-summary" aria-label="Writing review areas">
                {reviewAreas.map((area) => {
                  const count = reviewFindings.filter((finding) => finding.category === area.name).length
                  return (
                    <div key={area.name} className={activeFinding.category === area.name ? 'active' : ''}>
                      <strong>{area.name}</strong>
                      <span>{area.label}</span>
                      <small>{count} {count === 1 ? 'error' : 'errors'} found</small>
                    </div>
                  )
                })}
              </div>
              <small className="exercise-category">{activeFinding.category} · {activeProgress?.correctionComplete ? `practice ${Math.min(activeFinding.practice.length, (activeProgress?.practiceCompleted ?? 0) + 1)} of ${activeFinding.practice.length}` : 'your sentence'}</small>
              <h4 ref={questionHeadingRef} tabIndex={-1}>{activeFinding.message}</h4>
              <p>{activeTrial.prompt}</p>
              <div className="exercise-choices" role="radiogroup" aria-label={activeTrial.prompt}>
                {activeTrial.choices.map((choice) => {
                  const firstWrongChoice = Boolean(
                    answerState &&
                    !answerState.firstAttemptCorrect &&
                    choice === answerState.firstChoice,
                  )
                  const correctChoice = Boolean(answerState?.resolved && choice === activeTrial.correctAnswer)
                  const selected = answerState?.resolved
                    ? correctChoice
                    : answerState?.feedback.choice === choice
                  const stateLabel = correctChoice
                    ? ', correct answer'
                    : firstWrongChoice
                      ? ', your first answer, incorrect'
                      : selected
                        ? ', selected'
                        : ''
                  const disabled = Boolean(
                    answerState?.resolved ||
                    (answerState && !answerState.resolved && choice !== activeTrial.correctAnswer),
                  )
                  return (
                    <button
                      key={choice}
                      className={correctChoice ? 'correct' : firstWrongChoice ? 'incorrect' : selected ? 'selected' : ''}
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${choice}${stateLabel}`}
                      disabled={disabled}
                      onClick={() => chooseAnswer(choice)}
                    >{choice}</button>
                  )
                })}
              </div>
              {answerState && (
                <div className={answerState.resolved ? 'answer-message correct' : 'answer-message'} role="status" aria-live="assertive">
                  <strong>{answerState.feedback.summary}</strong>
                  <span>{answerState.feedback.explanation}</span>
                </div>
              )}
              {answerState?.resolved && <button className="primary-button full-button exercise-next" onClick={continueAfterAnswer}>Continue</button>}
            </div>
          ) : activeSpellingStep && activeSpellingWord ? (
            <form className="writing-exercise spelling-exercise" onSubmit={submitSpelling}>
              <div className="exercise-progress">
                <span>{spellingStepsComplete} of {totalSpellingSteps} spelling responses</span>
                <div><i style={{ width: `${totalSpellingSteps ? (spellingStepsComplete / totalSpellingSteps) * 100 : 100}%` }} /></div>
              </div>
              <small className="exercise-category">Spelling · {activeSpellingStep.phase === 'copy' ? 'show & copy' : activeSpellingStep.phase === 'hidden' ? 'hide & spell' : 'mixed review'} · {activeSpellingStep.attempt} of 3</small>
              <h4>{activeSpellingStep.prompt}</h4>
              <button className="speak-word-button" type="button" onClick={speakSpellingWord}><Volume2 size={17} /> Hear the word</button>
              <div className={activeSpellingStep.visible ? 'spelling-word visible' : 'spelling-word hidden'} aria-label={activeSpellingStep.visible ? activeSpellingWord.correctWord : 'Word hidden'}>
                {activeSpellingStep.visible ? activeSpellingWord.correctWord : '••••••'}
              </div>
              <label className="spelling-answer">
                <span>Type the word</span>
                <input
                  value={spellingAnswer}
                  onChange={(event) => setSpellingAnswer(event.target.value)}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  aria-label="Spelling answer"
                />
              </label>
              <button className="primary-button full-button" type="submit" disabled={!spellingAnswer.trim()}>Check spelling</button>
              {answerMessage && <p className={answerMessage.startsWith('Correct') ? 'answer-message correct' : 'answer-message'} aria-live="polite">{answerMessage}</p>}
            </form>
          ) : (
            <div className="writing-complete">
              <span>{pendingReviewCount > 0 ? <ShieldCheck size={24} /> : <Check size={24} />}</span>
              <h3>{pendingReviewCount > 0
                ? 'Waiting for parent review'
                : reviewFindings.length || reviewSpellingWords.length
                  ? 'Correction game complete!'
                  : 'This version is correct!'}</h3>
              <p>{pendingReviewCount > 0
                ? `${pendingReviewCount} contextual ${pendingReviewCount === 1 ? 'suggestion needs' : 'suggestions need'} a parent decision before this version can be called complete.`
                : reviewFindings.length || reviewSpellingWords.length
                  ? 'This version is saved. Return to your writing, make the corrections yourself, and check the next version.'
                  : 'No supported errors remain. Every saved version will be included in the weekly document.'}</p>
              {writingScore.total > 0 && (
                <div className="writing-score-card">
                  <small>FIRST-TRY SCORE</small>
                  <strong>{writingScore.percent}%</strong>
                  <p>{writingScore.correct} of {writingScore.total} questions correct on the first try</p>
                  <WritingAccuracyGraph points={writingScore.cumulativePercent} />
                </div>
              )}
              {reviewFindings.length > 0 && reviewDraft?.correctedBody && <div className="corrected-preview">{reviewDraft.correctedBody}</div>}
              {pendingReviewCount > 0 ? (
                <div className="spelling-pending"><ShieldCheck size={16} /><p><strong>Parent review required.</strong> Open Parent → Writing review tools to confirm or dismiss each contextual suggestion.</p></div>
              ) : reviewFindings.length > 0 ? (
                <button className="primary-button full-button" onClick={beginRevision}>Revise my writing</button>
              ) : (
                <>
                  <div className="spelling-complete"><Check size={16} /><p><strong>Ready for Friday delivery.</strong> The final checked version and every earlier version are saved.</p></div>
                  {dailyWritingActive && <button className="primary-button full-button" disabled={finishingWriting} onClick={() => { void finishDailyWriting() }}>{finishingWriting ? 'Saving result…' : 'Finish daily writing activity'}</button>}
                </>
              )}
              {finishMessage && <p className="answer-message" role="alert">{finishMessage}</p>}
              {!dailyWritingActive && reviewFindings.length === 0 && <button className="secondary-button full-button" onClick={() => setShowReview(false)}>Keep writing</button>}
            </div>
          )}
        </aside>
      </div>
      <div className="integration-note writing-log-note">
        <FileText size={19} />
        <div>
          <strong>Fionnbar’s writing log</strong>
          <p>{writingLog?.status === 'synced'
            ? `Synced ${writingLog.draftCount} saved ${writingLog.draftCount === 1 ? 'entry' : 'entries'} · newest first.`
            : writingLog?.status === 'syncing'
              ? 'Saving attempts and corrections to the linked document…'
              : writingLog?.status === 'failed'
                ? writingLog.lastError || 'The last document sync failed. Local copies are still safe.'
                : writingLog?.status === 'authorization-required'
                  ? 'Linked and waiting for Parent Google authorization.'
                  : writingLog?.status === 'safe-test'
                    ? 'Linked. Safe-test mode keeps writing local until live Google is enabled in Parent.'
                    : writingLog?.configured
                      ? 'Linked and ready to sync saved attempts and corrections.'
                      : 'No writing log document is configured.'}</p>
          {writingLogMessage && <p className="writing-log-message" role="status">{writingLogMessage}</p>}
        </div>
        <div className="writing-log-actions">
          {writingLog?.documentUrl && <a className="secondary-button" href={writingLog.documentUrl} target="_blank" rel="noreferrer">Open log</a>}
          {writingLog?.configured && <button className="secondary-button" type="button" disabled={writingLogBusy || serviceStatus !== 'online' || writingLog.status === 'safe-test' || writingLog.status === 'authorization-required'} onClick={() => { void syncWritingLogNow() }}>{writingLogBusy ? 'Syncing…' : 'Sync now'}</button>}
        </div>
      </div>
      <div className="integration-note"><Clock3 size={19} /><div><strong>Every version is saved for Friday.</strong><p>After the final check is correct, authorized live Google delivery puts each version in the weekly document and emails it to the teacher Friday at 12:00 p.m. Safe-test mode keeps it local.</p></div></div>
    </section>
  )
}

function RewardsView({ state, startTimer }: { state: AppState; startTimer: (timer: ActiveTimer) => void }) {
  return (
    <section className="page">
      <div className="rewards-hero">
        <div><p className="eyebrow">REWARD VAULT</p><h2>Time you earned yourself.</h2><p>Credits stay safe until Homework mode ends for the day.</p></div>
        <div className="ticket-count"><Gift size={30} /><strong>{state.rewardCredits.length}</strong><span>credits</span></div>
      </div>
      <div className="reward-content">
        <div>
          <div className="section-label"><span>AVAILABLE NOW</span><span>5 MIN EACH</span></div>
          {state.rewardCredits.length === 0 ? (
            <div className="empty-state"><span>✦</span><h3>Your reward vault is ready.</h3><p>Complete an optional practice session to earn a five-minute credit.</p></div>
          ) : (
            <div className="ticket-list">
              {state.rewardCredits.map((credit, index) => (
                <article className="reward-ticket" key={credit.id}>
                  <div className="ticket-number">{String(index + 1).padStart(2, '0')}</div>
                  <div><small>EARNED FROM</small><strong>{credit.source}</strong><p>{formatTimer(credit.remainingSeconds)} of YouTube time</p></div>
                  <button className="row-button" onClick={() => startTimer({ kind: 'reward', activityId: credit.id, label: 'YouTube reward', totalSeconds: 300, remainingSeconds: credit.remainingSeconds, running: true })}>Use now <Play size={15} fill="currentColor" /></button>
                </article>
              ))}
            </div>
          )}
        </div>
        <aside className="reward-rules">
          <h3><Volume2 size={20} /> How reward time works</h3>
          <ol><li><span>1</span>Choose a YouTube video.</li><li><span>2</span>Your timer starts when it plays.</li><li><span>3</span>Pauses, ads, and buffering don’t count.</li></ol>
          <div className="future-rewards"><small>MORE COMING LATER</small><div><span>Roblox</span><span>Codex</span></div></div>
        </aside>
      </div>
    </section>
  )
}

function SessionView({
  timer,
  toggle,
  complete,
  cancel,
}: {
  timer: ActiveTimer
  toggle: () => void
  complete: () => void
  cancel: () => void
}) {
  const serverRemaining = timer.phaseRemainingSeconds ?? timer.remainingSeconds
  const [displayRemaining, setDisplayRemaining] = useState(serverRemaining)
  const selectionDeadline = timer.rewardSelectionDeadlineAt
    ? new Date(timer.rewardSelectionDeadlineAt).getTime()
    : null
  const [selectionRemaining, setSelectionRemaining] = useState(() => selectionDeadline
    ? Math.max(0, Math.ceil((selectionDeadline - Date.now()) / 1_000))
    : 0)
  useEffect(() => {
    setDisplayRemaining(serverRemaining)
    if (!timer.running || timer.status !== 'active' || serverRemaining <= 0 || timer.waitingForVerification) return
    const interval = window.setInterval(() => {
      setDisplayRemaining((current) => Math.max(0, current - 1))
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [serverRemaining, timer.running, timer.status, timer.waitingForVerification, timer.phaseIndex])

  useEffect(() => {
    if (!selectionDeadline || timer.rewardPlaybackStarted || timer.status === 'completed') return
    const update = () => setSelectionRemaining(Math.max(0, Math.ceil((selectionDeadline - Date.now()) / 1_000)))
    update()
    const interval = window.setInterval(update, 1_000)
    return () => window.clearInterval(interval)
  }, [selectionDeadline, timer.rewardPlaybackStarted, timer.status])

  const displayTotal = timer.phaseTotalSeconds ?? timer.totalSeconds
  const elapsed = Math.max(0, displayTotal - displayRemaining)
  const percent = displayTotal > 0 ? Math.min(100, (elapsed / displayTotal) * 100) : 0
  const done = timer.status === 'completed'
  const managed = timer.managedChromeRequired === true
  const selectingReward = timer.kind === 'reward' && !timer.rewardPlaybackStarted && !done
  const statusLabel = done
    ? 'SESSION COMPLETE'
    : selectingReward
      ? 'CHOOSE A VIDEO'
      : timer.kind === 'reward' && timer.rewardPlaybackActive
        ? 'PLAYBACK TIME IS COUNTING'
        : timer.kind === 'reward'
          ? 'PLAYBACK PAUSED'
    : timer.waitingForVerification
      ? 'WAITING FOR CLEVER LOGIN'
      : timer.running
        ? 'ACTIVE FOCUS TIME'
        : managed
          ? 'APPROVED PAGE REQUIRED'
          : 'SESSION PAUSED'
  const sessionCopy = done
    ? 'You did it. Your progress is ready to save.'
    : selectingReward
      ? 'Managed Chrome opened a separate YouTube window. Start a video before the selection window ends to use this credit.'
      : timer.kind === 'reward'
        ? 'Only visible video playback counts. Pauses, buffering, ads, and time outside the YouTube window do not use your credit.'
    : timer.waitingForVerification
      ? 'Sign in through Clever. The timer begins only after managed Chrome verifies Level Learning.'
      : managed
        ? 'Only active time on a parent-approved origin counts. Leaving that page pauses credit automatically.'
        : 'Keep this approved activity in front. Time pauses whenever you leave.'
  return (
    <section className="session-page">
      <div className="session-card">
        <div className="session-status"><span className={timer.running ? 'pulse' : ''} /> {statusLabel}</div>
        <div className="timer-ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{timer.waitingForVerification ? '—:—' : formatTimer(selectingReward ? selectionRemaining : displayRemaining)}</strong><small>{timer.waitingForVerification ? 'login gate' : selectingReward ? 'to choose' : displayRemaining === 0 && !done ? 'verifying' : 'remaining'}</small></div>
        </div>
        <p className="eyebrow">{timer.kind === 'reward' ? 'ENJOY YOUR REWARD' : 'CURRENT ACTIVITY'}</p>
        <h2>{timer.label}</h2>
        {timer.phaseCount && timer.phaseCount > 1 && <div className="phase-pill">STEP {(timer.phaseIndex ?? 0) + 1} OF {timer.phaseCount} · {timer.phaseLabel}</div>}
        <p className="session-copy">{sessionCopy}</p>
        {!done && timer.launchUrl && timer.kind !== 'reward' && (
          <a className="row-button session-launch" href={timer.launchUrl} target="_blank" rel="noreferrer">
            <Play size={16} fill="currentColor" /> Open {timer.phaseLabel ?? timer.label}
          </a>
        )}
        {!done ? (
          <div className="session-actions">
            {!managed && <button className="secondary-button" onClick={toggle}>{timer.running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}{timer.running ? 'Pause' : 'Resume'}</button>}
            <button className="text-button danger" onClick={cancel}><X size={17} /> End session</button>
          </div>
        ) : (
          <button className="primary-button" onClick={complete}><Check size={19} /> Return to learning path</button>
        )}
        <div className="focus-note"><ShieldCheck size={17} /> {timer.kind === 'reward' ? 'Managed Chrome verifies foreground, non-ad playback' : managed ? 'Managed Chrome verifies the approved origin every five seconds' : 'Server verified · checks focus every five seconds'}</div>
      </div>
    </section>
  )
}

function ParentRoute(props: {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  day: DayName
  setDay: (day: DayName) => void
  serviceStatus: 'connecting' | 'online' | 'offline'
  serviceMeta: ServiceMeta | null
  reconnectService: () => void
}) {
  const [authorization, setAuthorization] = useState<ParentAuthorizationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refreshAuthorization = async () => {
    const status = await getParentAuthorizationStatus()
    setAuthorization(status)
    return status
  }

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      getParentAuthorizationStatus()
        .then((status) => {
          if (!cancelled) setAuthorization(status)
        })
        .catch((error) => {
          if (!cancelled) setMessage(error instanceof Error ? error.message : 'Parent authorization status is unavailable.')
        })
    }
    void refresh()
    const interval = window.setInterval(refresh, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const authorize = async (purpose: 'dashboard' | 'sensitive') => {
    setBusy(true)
    setMessage('Waiting for the macOS administrator authorization window…')
    try {
      const { challenge } = await startParentAuthorization(purpose)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        const result = await pollParentAuthorization(challenge.id)
        if (result.status === 'pending') continue
        if (result.status !== 'approved') {
          throw new Error(result.status === 'denied'
            ? 'Administrator authorization was denied.'
            : 'The authorization request expired. Try again.')
        }
        const status = await refreshAuthorization()
        setMessage(purpose === 'sensitive'
          ? 'Sensitive action reauthorized by macOS.'
          : 'Parent controls unlocked.')
        return status
      }
      throw new Error('The authorization request timed out. Try again.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Parent controls could not be unlocked.')
      throw error
    } finally {
      setBusy(false)
    }
  }

  const lock = async () => {
    await lockParentSession().catch(() => null)
    setAuthorization((current) => current ? { ...current, authenticated: false } : current)
    setMessage('Parent controls are locked.')
  }

  if (!authorization?.authenticated) {
    return (
      <section className="page parent-access-page">
        <div className="parent-access-card">
          <span className="parent-access-icon"><LockKeyhole size={30} /></span>
          <p className="eyebrow">PARENT CONTROLS</p>
          <h2>Administrator authorization required.</h2>
          <p>The macOS guardian asks the Security Agent to verify an administrator. This app never receives or stores the administrator password.</p>
          <div className="authorization-readiness">
            <div><span className={authorization?.configured ? 'dot good' : 'dot'} /><span><strong>Guardian secret</strong><small>{authorization?.configured ? 'Configured' : 'Add the same 32+ character secret to the service and guardian configuration'}</small></span></div>
            <div><span className={authorization?.guardianConnected ? 'dot good' : 'dot'} /><span><strong>macOS guardian</strong><small>{authorization?.guardianConnected ? 'Connected and ready to prompt' : 'Start the guardian and wait for its heartbeat'}</small></span></div>
          </div>
          <button
            className="primary-button"
            disabled={busy || !authorization?.configured || !authorization?.guardianConnected}
            onClick={() => { void authorize('dashboard').catch(() => {}) }}
          >
            <ShieldCheck size={17} /> {busy ? 'Waiting for macOS…' : 'Authorize on this Mac'}
          </button>
          {message && <p className="authorization-message" role="status">{message}</p>}
        </div>
      </section>
    )
  }

  return (
    <ParentView
      {...props}
      authorization={authorization}
      lockParent={lock}
      reauthorize={() => authorize('sensitive')}
    />
  )
}

function ParentView({
  state,
  setState,
  day,
  setDay,
  serviceStatus,
  serviceMeta,
  reconnectService,
  authorization,
  lockParent,
  reauthorize,
}: {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  day: DayName
  setDay: (day: DayName) => void
  serviceStatus: 'connecting' | 'online' | 'offline'
  serviceMeta: ServiceMeta | null
  reconnectService: () => void
  authorization: ParentAuthorizationStatus
  lockParent: () => Promise<void>
  reauthorize: () => Promise<ParentAuthorizationStatus>
}) {
  const [googleAccount, setGoogleAccount] = useState(state.googleProof.accountEmail ?? 'parent-test@example.com')
  const [googleRecipient, setGoogleRecipient] = useState(
    state.googleProof.deliveries[0]?.recipient ?? 'school-test@example.com',
  )
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleMessage, setGoogleMessage] = useState('')
  const [liveGoogleRecipient, setLiveGoogleRecipient] = useState(state.googleLive.recipient ?? '')
  const [liveGoogleBusy, setLiveGoogleBusy] = useState(false)
  const [liveGoogleMessage, setLiveGoogleMessage] = useState('')
  const [activityConfig, setActivityConfig] = useState<ActivityConfiguration>(() => structuredClone(state.activityConfiguration))
  const [configurationBusy, setConfigurationBusy] = useState(false)
  const [configurationMessage, setConfigurationMessage] = useState('')
  const [knownNames, setKnownNames] = useState(state.writingDictionary.knownNames.join('\n'))
  const [knownPlaces, setKnownPlaces] = useState(state.writingDictionary.knownPlaces.join('\n'))
  const [writingConfigurationMessage, setWritingConfigurationMessage] = useState('')
  const [aiProofreading, setAiProofreading] = useState<AiProofreadingStatus | null>(null)
  const [aiProofreadingMode, setAiProofreadingMode] = useState<AiProofreadingMode>('off')
  const [aiProofreadingBusy, setAiProofreadingBusy] = useState(false)
  const [aiProofreadingMessage, setAiProofreadingMessage] = useState('')
  const [reviewReplacements, setReviewReplacements] = useState<Record<string, string>>({})

  useEffect(() => {
    const receiveAuthorization = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'fionnbar-google-oauth') return
      loadStateFromService()
        .then((response) => {
          setState(response.state)
          setLiveGoogleMessage(event.data.success
            ? 'Google authorization completed. The refresh token is secured in macOS Keychain.'
            : 'Google authorization was not completed.')
        })
        .catch((error) => setLiveGoogleMessage(error instanceof Error ? error.message : 'Google status could not be refreshed.'))
    }
    window.addEventListener('message', receiveAuthorization)
    return () => window.removeEventListener('message', receiveAuthorization)
  }, [setState])

  useEffect(() => {
    if (serviceStatus !== 'online') return
    let cancelled = false
    getAiProofreadingStatus()
      .then((status) => {
        if (cancelled) return
        setAiProofreading(status)
        setAiProofreadingMode(status.mode)
      })
      .catch((error) => {
        if (!cancelled) setAiProofreadingMessage(error instanceof Error ? error.message : 'AI proofreading status is unavailable.')
      })
    return () => { cancelled = true }
  }, [serviceStatus])

  const parseOrigins = (value: string) => value.split(/[\n,]+/).map((origin) => origin.trim()).filter(Boolean)
  const parseDictionary = (value: string) => [...new Map(
    value.split(/[\n,]+/)
      .map((item) => item.trim().replace(/\s+/g, ' '))
      .filter((item) => item && item.length <= 80)
      .map((item) => [item.toLocaleLowerCase(), item]),
  ).values()].slice(0, 100)

  const saveConfiguration = async () => {
    if (serviceStatus !== 'online') {
      setConfigurationMessage('Reconnect the local service before saving activity URLs.')
      return
    }
    setConfigurationBusy(true)
    setConfigurationMessage('')
    try {
      const response = await saveActivityConfiguration(activityConfig)
      setState(response.state)
      setActivityConfig(structuredClone(response.state.activityConfiguration))
      setConfigurationMessage('Activity URLs and exact approved origins were saved locally.')
    } catch (error) {
      setConfigurationMessage(error instanceof Error ? error.message : 'The activity configuration could not be saved.')
    } finally {
      setConfigurationBusy(false)
    }
  }

  const saveWritingConfiguration = async () => {
    const writingDictionary = {
      knownNames: parseDictionary(knownNames),
      knownPlaces: parseDictionary(knownPlaces),
    }
    setWritingConfigurationMessage('')
    try {
      const response = await saveWritingDictionary(writingDictionary)
      setState(response.state)
      setWritingConfigurationMessage('The local names and places dictionary was saved. Recheck a draft to apply it.')
    } catch (error) {
      setWritingConfigurationMessage(error instanceof Error ? error.message : 'The writing dictionary could not be saved.')
    }
  }

  const saveAiConfiguration = async () => {
    setAiProofreadingBusy(true)
    setAiProofreadingMessage('')
    try {
      const status = await saveAiProofreadingMode(aiProofreadingMode)
      setAiProofreading(status)
      setAiProofreadingMode(status.mode)
      setAiProofreadingMessage(status.mode === 'off'
        ? 'AI proofreading is off. Writing stays with the local checker.'
        : `${status.mode === 'shadow' ? 'Shadow' : status.mode === 'review' ? 'Parent review' : 'Guided practice'} mode is active.`)
    } catch (error) {
      setAiProofreadingMessage(error instanceof Error ? error.message : 'AI proofreading mode could not be saved.')
    } finally {
      setAiProofreadingBusy(false)
    }
  }

  const reviewWritingSuggestion = async (id: string, decision?: 'confirmed' | 'dismissed') => {
    const status = decision ? 'resolved' : 'pending'
    const item = state.writingReviewQueue.find((candidate) => candidate.id === id)
    const replacement = decision === 'confirmed'
      ? reviewReplacements[id] ?? item?.replacement
      : undefined
    try {
      const response = await saveWritingReviewStatus(id, status, decision, replacement)
      setState(response.state)
    } catch (error) {
      setWritingConfigurationMessage(error instanceof Error ? error.message : 'The review status could not be saved.')
    }
  }

  const connectGoogleProof = async () => {
    if (serviceStatus !== 'online') {
      setGoogleMessage('Reconnect the local service before using the delivery proof.')
      return
    }
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      const response = await connectMockGoogle(googleAccount)
      setState(response.state)
      setGoogleMessage('Safe test account connected. No Google authorization occurred.')
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'The test account could not be connected.')
    } finally {
      setGoogleBusy(false)
    }
  }

  const disconnectGoogleProof = async () => {
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      await reauthorize()
      const response = await disconnectMockGoogle()
      setState(response.state)
      setGoogleMessage('Safe test account disconnected. Existing local proof records were preserved.')
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'The test account could not be disconnected.')
    } finally {
      setGoogleBusy(false)
    }
  }

  const deliverGoogleProof = async () => {
    if (serviceStatus !== 'online') {
      setGoogleMessage('Reconnect the local service before generating a delivery proof.')
      return
    }
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      await saveStateToService(state)
      const response = await runMockGoogleDelivery(googleRecipient)
      setState(response.state)
      setGoogleMessage(
        response.duplicate
          ? 'Duplicate prevented: this week already has a proof delivery record.'
          : response.delivery.status === 'skipped'
            ? 'Nothing was sent: there are no non-empty writing drafts for this week.'
            : 'Local document and PDF created. Drive, sharing, and email were simulated only.',
      )
    } catch (error) {
      setGoogleMessage(error instanceof Error ? error.message : 'The delivery proof could not be generated.')
    } finally {
      setGoogleBusy(false)
    }
  }

  const saveLiveGoogleRecipient = async () => {
    setLiveGoogleBusy(true)
    setLiveGoogleMessage('')
    try {
      const response = await saveLiveGoogleConfiguration(liveGoogleRecipient)
      setState(response.state)
      setLiveGoogleRecipient(response.googleLive.recipient ?? liveGoogleRecipient)
      setLiveGoogleMessage('The school recipient was saved locally.')
    } catch (error) {
      setLiveGoogleMessage(error instanceof Error ? error.message : 'The school recipient could not be saved.')
    } finally {
      setLiveGoogleBusy(false)
    }
  }

  const authorizeLiveGoogle = async () => {
    setLiveGoogleBusy(true)
    setLiveGoogleMessage('')
    try {
      await reauthorize()
      const authorization = await beginLiveGoogleAuthorization()
      const popup = window.open(authorization.authorizationUrl, 'fionnbar-google-oauth', 'popup,width=620,height=760')
      if (!popup) throw new Error('Allow pop-ups for this local app, then try again.')
      setLiveGoogleMessage('Finish authorization in the Google window. This page will update when it returns.')
    } catch (error) {
      setLiveGoogleMessage(error instanceof Error ? error.message : 'Google authorization could not start.')
    } finally {
      setLiveGoogleBusy(false)
    }
  }

  const revokeLiveGoogle = async () => {
    setLiveGoogleBusy(true)
    setLiveGoogleMessage('')
    try {
      await reauthorize()
      const response = await disconnectLiveGoogle()
      setState(response.state)
      setLiveGoogleMessage(response.googleLive.lastError ?? 'Google authorization was revoked and the Keychain token was removed.')
    } catch (error) {
      setLiveGoogleMessage(error instanceof Error ? error.message : 'Google authorization could not be revoked.')
    } finally {
      setLiveGoogleBusy(false)
    }
  }

  const deliverLiveGoogle = async () => {
    setLiveGoogleBusy(true)
    setLiveGoogleMessage('')
    try {
      await reauthorize()
      await saveStateToService(state)
      await saveLiveGoogleConfiguration(liveGoogleRecipient)
      const response = await runLiveGoogleDelivery(liveGoogleRecipient)
      setState(response.state)
      setLiveGoogleMessage(
        response.duplicate
          ? 'Duplicate prevented: this week already has a live delivery record.'
          : response.delivery.status === 'skipped'
            ? 'Nothing was sent because no writing is marked complete.'
            : response.delivery.shareStatus === 'failed'
              ? 'The PDF was emailed, but the Google Doc could not be shared. The failure was recorded.'
              : 'The Google Doc was shared view-only and its PDF was emailed.',
      )
    } catch (error) {
      const refreshed = await loadStateFromService().catch(() => null)
      if (refreshed) setState(refreshed.state)
      setLiveGoogleMessage(error instanceof Error ? error.message : 'The live Google delivery failed and was queued for retry.')
    } finally {
      setLiveGoogleBusy(false)
    }
  }

  const retryLiveGoogle = async (deliveryId: string) => {
    setLiveGoogleBusy(true)
    setLiveGoogleMessage('')
    try {
      await reauthorize()
      const response = await retryLiveGoogleDelivery(deliveryId)
      setState(response.state)
      setLiveGoogleMessage('The failed Google delivery completed successfully.')
    } catch (error) {
      const refreshed = await loadStateFromService().catch(() => null)
      if (refreshed) setState(refreshed.state)
      setLiveGoogleMessage(error instanceof Error ? error.message : 'The retry did not complete.')
    } finally {
      setLiveGoogleBusy(false)
    }
  }

  const toggleOverride = async (activityId: string) => {
    const wasComplete = state.requiredByDay[day].includes(activityId)
    if (serviceStatus !== 'online') {
      setConfigurationMessage('Reconnect the local service before changing completion history.')
      return
    }
    try {
      const response = await setDailyCompletion(
        day,
        activityId,
        !wasComplete,
        'parent-override',
        state.weekContext.weekId,
      )
      setState(response.state)
    } catch (error) {
      if (isStaleWeekError(error)) {
        const response = await loadStateFromService()
        setState(response.state)
        return
      }
      setConfigurationMessage(error instanceof Error ? error.message : 'Completion history could not be changed.')
    }
  }
  const addCredit = async () => {
    try {
      const response = await addParentRewardCredit(300)
      setState(response.state)
    } catch (error) {
      setConfigurationMessage(error instanceof Error ? error.message : 'The reward credit could not be added.')
    }
  }
  const reset = async () => {
    if (!window.confirm('Reset all preview progress on this Mac? This cannot be undone.')) return
    try {
      await reauthorize()
      const response = await resetParentPreviewData()
      setState(response.state)
    } catch (error) {
      setConfigurationMessage(error instanceof Error ? error.message : 'Preview data could not be reset.')
    }
  }
  return (
    <section className="page parent-page">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">PARENT DASHBOARD · AUTHORIZED</p><h2>See what’s happening.</h2><p>This short-lived session was approved by macOS. Sensitive actions ask again.</p></div>
        <button className="admin-pill" onClick={() => { void lockParent() }}><CircleUserRound size={20} /><span><small>SESSION EXPIRES</small><strong>{authorization.expiresAt ? new Date(authorization.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Soon'} · Lock</strong></span></button>
      </div>
      <div className="parent-stats">
        <div><small>WEEKLY PRACTICE</small><strong>{state.optionalCompleted.length}<span>/{OPTIONAL_SESSION_TOTAL}</span></strong></div>
        <div><small>REWARD CREDITS</small><strong>{state.rewardCredits.length}</strong></div>
        <div><small>WRITING DRAFTS</small><strong>{state.drafts.length}</strong></div>
        <div><small>GUARDIAN</small><strong className={state.guardianConnected ? 'status-good' : 'status-warn'}>{state.guardianConnected ? 'Connected' : 'Not linked'}</strong></div>
        <div><small>STORAGE</small><strong className={serviceStatus === 'online' ? 'status-good' : 'status-warn'}>{serviceStatus === 'online' ? 'SQLite' : 'Browser'}</strong></div>
      </div>
      <div className="parent-grid">
        <div className="parent-panel">
          <div className="panel-heading"><div><h3>Daily completion</h3><p>Use these as preview overrides.</p></div><select value={day} onChange={(event) => setDay(event.target.value as DayName)}>{DAYS.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="override-list">
            {activeRequiredActivities().map((activity) => {
              const done = state.requiredByDay[day].includes(activity.id)
              return <button key={activity.id} onClick={() => toggleOverride(activity.id)}><span className={done ? 'override-check done' : 'override-check'}>{done && <Check size={15} />}</span><span><strong>{activity.title}</strong><small>{activity.method === 'self' ? 'Self-reported' : activity.method === 'timer' ? 'Time-in-session' : 'Game-verified'}</small></span><span>{done ? 'Complete' : 'Incomplete'}</span></button>
            })}
          </div>
        </div>
        <div className="parent-panel integration-panel">
          <div className="panel-heading"><div><h3>System connections</h3><p>Local proofs and live integrations.</p></div></div>
          <div className="connection-row"><span className={serviceStatus === 'online' ? 'dot good' : 'dot'} /><div><strong>Local data service</strong><small>{serviceStatus === 'online' ? `SQLite schema ${serviceMeta?.schemaVersion ?? 1} · restart-safe` : 'Using browser backup storage'}</small></div>{serviceStatus === 'online' ? <b>Connected</b> : <button onClick={reconnectService}>Retry</button>}</div>
          <div className="connection-row"><span className={state.guardianConnected ? 'dot good' : 'dot'} /><div><strong>macOS guardian</strong><small>{state.guardianConnected ? 'Heartbeat received within 15 seconds' : 'No live guardian heartbeat'}</small></div><b>{state.guardianConnected ? 'Connected' : 'Pending'}</b></div>
          <div className="connection-row"><span className={state.chromeConnected ? 'dot good' : 'dot'} /><div><strong>Managed Chrome</strong><small>{state.chromeConnected ? 'Extension heartbeat received within 45 seconds' : 'Policy and extension not installed'}</small></div><b>{state.chromeConnected ? 'Connected' : 'Pending'}</b></div>
          <div className="connection-row"><span className={state.googleProof.connected ? 'dot good' : 'dot'} /><div><strong>Google delivery proof</strong><small>{state.googleProof.connected ? `${state.googleProof.accountEmail} · no external access` : 'Safe test account not connected'}</small></div><b>{state.googleProof.connected ? 'Test ready' : 'Pending'}</b></div>
          <div className="connection-row"><span className={state.googleLive.connected ? 'dot good' : 'dot'} /><div><strong>Live Google delivery</strong><small>{state.googleLive.connected ? `${state.googleLive.accountEmail} · token in Keychain` : state.googleLive.enabled ? 'Waiting for parent authorization' : 'Disabled while safe-test mode is active'}</small></div><b>{state.googleLive.connected ? 'Connected' : state.googleLive.enabled ? 'Pending' : 'Off'}</b></div>
          <div className="connection-row"><span className="dot good" /><div><strong>Reading game contract</strong><small>Local simulator and verified completion are ready</small></div><b>Test ready</b></div>
          <button className="secondary-button full-button" onClick={addCredit}><Plus size={17} /> Add a 5-minute credit</button>
        </div>
      </div>
      <div className="parent-panel activity-configuration-panel">
        <div className="panel-heading">
          <div><h3>Controlled activity setup</h3><p>Enter only parent-reviewed school URLs. Missing or invalid configuration fails closed.</p></div>
          <span className="mock-badge">LOCAL CONFIGURATION</span>
        </div>
        <div className="activity-config-grid">
          <fieldset>
            <legend><span>Ninja Dojo</span><b className={activityConfig.ninjaDojo.ready ? 'ready' : ''}>{activityConfig.ninjaDojo.ready ? 'Ready' : 'Needs URL'}</b></legend>
            <label><span>5th Grade Learning Hub URL</span><input type="url" placeholder="https://…" value={activityConfig.ninjaDojo.launchUrl} onChange={(event) => setActivityConfig((current) => ({ ...current, ninjaDojo: { ...current.ninjaDojo, launchUrl: event.target.value, ready: false } }))} /></label>
            <label><span>Additional approved origins</span><textarea rows={3} placeholder="https://login.example.org" value={activityConfig.ninjaDojo.redirectOrigins.join('\n')} onChange={(event) => setActivityConfig((current) => ({ ...current, ninjaDojo: { ...current.ninjaDojo, redirectOrigins: parseOrigins(event.target.value), ready: false } }))} /></label>
            <small>17 active minutes on an approved origin.</small>
          </fieldset>
          <fieldset>
            <legend><span>Du Chinese</span><b className={activityConfig.duChinese.ready ? 'ready' : ''}>{activityConfig.duChinese.ready ? 'Ready' : 'Needs URLs'}</b></legend>
            <label><span>Reading URL</span><input type="url" placeholder="https://…" value={activityConfig.duChinese.readingUrl} onChange={(event) => setActivityConfig((current) => ({ ...current, duChinese: { ...current.duChinese, readingUrl: event.target.value, ready: false } }))} /></label>
            <label><span>Flashcard URL</span><input type="url" placeholder="https://…" value={activityConfig.duChinese.flashcardUrl} onChange={(event) => setActivityConfig((current) => ({ ...current, duChinese: { ...current.duChinese, flashcardUrl: event.target.value, ready: false } }))} /></label>
            <label><span>Additional approved origins</span><textarea rows={3} placeholder="https://login.example.org" value={activityConfig.duChinese.redirectOrigins.join('\n')} onChange={(event) => setActivityConfig((current) => ({ ...current, duChinese: { ...current.duChinese, redirectOrigins: parseOrigins(event.target.value), ready: false } }))} /></label>
            <small>13 minutes reading, then 7 minutes of flashcards.</small>
          </fieldset>
          <fieldset>
            <legend><span>Level Chinese</span><b className={activityConfig.levelChinese.ready ? 'ready' : ''}>{activityConfig.levelChinese.ready ? 'Ready' : 'Needs URLs'}</b></legend>
            <label><span>Clever login URL</span><input type="url" placeholder="https://…" value={activityConfig.levelChinese.cleverUrl} onChange={(event) => setActivityConfig((current) => ({ ...current, levelChinese: { ...current.levelChinese, cleverUrl: event.target.value, ready: false } }))} /></label>
            <label><span>Level Learning URL</span><input type="url" placeholder="https://…" value={activityConfig.levelChinese.learningUrl} onChange={(event) => setActivityConfig((current) => ({ ...current, levelChinese: { ...current.levelChinese, learningUrl: event.target.value, ready: false } }))} /></label>
            <label><span>Additional approved origins</span><textarea rows={3} placeholder="https://district-login.example.org" value={activityConfig.levelChinese.redirectOrigins.join('\n')} onChange={(event) => setActivityConfig((current) => ({ ...current, levelChinese: { ...current.levelChinese, redirectOrigins: parseOrigins(event.target.value), ready: false } }))} /></label>
            <small>The timer waits for managed Chrome to verify Level Learning.</small>
          </fieldset>
        </div>
        <div className="configuration-actions">
          <p>Launch origins are added automatically. Extra origins are for reviewed login and redirect steps only.</p>
          <button className="primary-button" onClick={saveConfiguration} disabled={configurationBusy || serviceStatus !== 'online'}><ShieldCheck size={16} /> {configurationBusy ? 'Saving…' : 'Save activity setup'}</button>
        </div>
        {configurationMessage && <p className="google-proof-message configuration-message" role="status">{configurationMessage}</p>}
      </div>
      <div className="parent-panel writing-review-panel">
        <div className="panel-heading">
          <div><h3>Writing review tools</h3><p>Teach known capitalization and decide contextual suggestions before a draft can be completed.</p></div>
          <span className="mock-badge">{state.writingReviewQueue.filter((item) => item.status === 'pending').length} TO REVIEW</span>
        </div>
        <div className="writing-tools-grid">
          <div className="writing-dictionary-form">
            <div className="ai-proofreading-settings">
              <div className="delivery-heading"><strong>AI second pass</strong><small>{aiProofreading?.configured ? 'READY' : 'NOT CONFIGURED'}</small></div>
              <label>
                <span>Review mode</span>
                <select value={aiProofreadingMode} onChange={(event) => setAiProofreadingMode(event.target.value as AiProofreadingMode)}>
                  <option value="off">Off — local checks only</option>
                  <option value="shadow" disabled={!aiProofreading?.configured}>Shadow — measure, show nothing</option>
                  <option value="review" disabled={!aiProofreading?.configured}>Parent review — no child corrections</option>
                  <option value="assist" disabled={!aiProofreading?.configured}>Guided practice — high confidence only</option>
                </select>
              </label>
              <p>Only the current passage is sent. The title, name, history, and writing log are excluded. Responses are requested with storage disabled.</p>
              {aiProofreading?.model && <small className="ai-model-label">Model: {aiProofreading.model}</small>}
              <button className="secondary-button" disabled={aiProofreadingBusy || serviceStatus !== 'online'} onClick={saveAiConfiguration}>{aiProofreadingBusy ? 'Saving…' : 'Save AI mode'}</button>
              {aiProofreadingMessage && <p className="google-proof-message" role="status">{aiProofreadingMessage}</p>}
            </div>
            <label><span>Known names</span><textarea rows={5} value={knownNames} onChange={(event) => setKnownNames(event.target.value)} placeholder={'Fionnbar\nTeacher name'} /></label>
            <label><span>Known places</span><textarea rows={5} value={knownPlaces} onChange={(event) => setKnownPlaces(event.target.value)} placeholder={'San Francisco\nSchool name'} /></label>
            <p>Use one name or place per line. The saved capitalization becomes the required form during the next draft check.</p>
            <button className="primary-button" onClick={saveWritingConfiguration}><BookOpen size={16} /> Save writing dictionary</button>
            {writingConfigurationMessage && <p className="google-proof-message" role="status">{writingConfigurationMessage}</p>}
          </div>
          <div className="writing-review-list">
            <div className="delivery-heading"><strong>Parent review findings</strong><small>Pending decisions block final completion</small></div>
            {state.writingReviewQueue.length === 0 ? (
              <div className="completion-empty">No ambiguous writing findings are waiting for parent review.</div>
            ) : state.writingReviewQueue.slice().reverse().slice(0, 10).map((item) => (
              <div className={`writing-review-row ${item.status}`} key={item.id}>
                <span><strong>{item.category}</strong><small>{item.source === 'ai'
                  ? `AI verified workflow · ${item.confidence ?? 'review'} · ${item.decision ?? item.status}`
                  : item.source === 'languagetool'
                    ? `LanguageTool candidate · ${item.decision ?? item.status}`
                    : item.decision ?? item.status}</small></span>
                <div>
                  <strong>{item.message}</strong>
                  <p>{item.excerpt}</p>
                  {item.explanation && <p className="review-explanation">{item.explanation}</p>}
                  {item.status === 'pending' && typeof item.start === 'number' && typeof item.end === 'number' && (
                    <label>
                      <span>Parent-approved replacement</span>
                      <input
                        value={reviewReplacements[item.id] ?? item.replacement ?? ''}
                        onChange={(event) => setReviewReplacements((current) => ({ ...current, [item.id]: event.target.value }))}
                        list={`review-options-${item.id}`}
                      />
                      {item.alternatives && item.alternatives.length > 0 && (
                        <datalist id={`review-options-${item.id}`}>
                          {item.alternatives.map((alternative) => <option key={alternative} value={alternative} />)}
                        </datalist>
                      )}
                    </label>
                  )}
                </div>
                {item.status === 'pending' ? (
                  <span className="review-decision-actions">
                    {typeof item.start === 'number' && typeof item.end === 'number' && (
                      <button
                        className="row-button"
                        disabled={!(reviewReplacements[item.id] ?? item.replacement ?? '') && !(item.end! > item.start!)}
                        onClick={() => reviewWritingSuggestion(item.id, 'confirmed')}
                      >{(reviewReplacements[item.id] ?? item.replacement ?? '') ? 'Confirm correction' : 'Confirm deletion'}</button>
                    )}
                    <button className="row-button" onClick={() => reviewWritingSuggestion(item.id, 'dismissed')}>Dismiss</button>
                  </span>
                ) : (
                  <button className="row-button" onClick={() => reviewWritingSuggestion(item.id)}>Reopen</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="parent-panel google-proof-panel">
        <div className="panel-heading">
          <div><h3>Google delivery proof</h3><p>Creates local artifacts and an audit record without contacting Google or sending email.</p></div>
          <span className="mock-badge">SAFE TEST MODE</span>
        </div>
        <div className="google-proof-content">
          <div className="google-proof-form">
            <label>
              <span>Test Google account</span>
              <input type="email" value={googleAccount} onChange={(event) => setGoogleAccount(event.target.value)} disabled={state.googleProof.connected || googleBusy} />
            </label>
            {!state.googleProof.connected ? (
              <button className="secondary-button" onClick={connectGoogleProof} disabled={googleBusy || serviceStatus !== 'online'}>
                <ShieldCheck size={16} /> Connect test account
              </button>
            ) : (
              <button className="text-button danger" onClick={disconnectGoogleProof} disabled={googleBusy}>
                <X size={16} /> Disconnect test account
              </button>
            )}
            <label>
              <span>Test school recipient</span>
              <input type="email" value={googleRecipient} onChange={(event) => setGoogleRecipient(event.target.value)} disabled={googleBusy} />
            </label>
            <button className="primary-button" onClick={deliverGoogleProof} disabled={googleBusy || !state.googleProof.connected || serviceStatus !== 'online'}>
              <Send size={16} /> {googleBusy ? 'Working…' : 'Run delivery proof'}
            </button>
            {googleMessage && <p className="google-proof-message" role="status">{googleMessage}</p>}
          </div>
          <div className="delivery-history">
            <div className="delivery-heading"><strong>Recent proof deliveries</strong><small>One record per weekly document</small></div>
            {state.googleProof.deliveries.length === 0 ? (
              <div className="completion-empty">No delivery proofs have run yet. Save a writing draft, then run the proof.</div>
            ) : state.googleProof.deliveries.slice(0, 5).map((delivery) => (
              <div className="delivery-row" key={delivery.id}>
                <span className={`delivery-icon ${delivery.status}`}><FileText size={17} /></span>
                <span>
                  <strong>Week of {delivery.weekId}</strong>
                  <small>{delivery.draftCount} {delivery.draftCount === 1 ? 'draft' : 'drafts'} · {delivery.recipient} · attempt {delivery.attemptCount}</small>
                  {delivery.lastError && <small className="delivery-error">{delivery.lastError}</small>}
                </span>
                <span className="delivery-actions">
                  <b className={`delivery-status ${delivery.status}`}>{delivery.status === 'simulated' ? 'Test delivered' : delivery.status}</b>
                  {delivery.documentUrl && <a href={delivery.documentUrl}><FileText size={14} /> Document</a>}
                  {delivery.pdfUrl && <a href={delivery.pdfUrl}><Download size={14} /> PDF</a>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="parent-panel google-proof-panel live-google-panel">
        <div className="panel-heading">
          <div><h3>Live Friday Google delivery</h3><p>Creates the weekly Google Doc with every saved writing version, exports a verified PDF, shares view-only, and emails the school recipient Friday at 12:00 p.m.</p></div>
          <span className={`mock-badge ${state.googleLive.enabled ? 'live-badge' : ''}`}>{state.googleLive.enabled ? 'LIVE MODE' : 'SAFE MODE ACTIVE'}</span>
        </div>
        <div className="google-proof-content">
          <div className="google-proof-form">
            <div className="live-readiness">
              <small>Desktop OAuth client <b>{state.googleLive.clientConfigured ? 'ready' : 'missing'}</b></small>
              <small>macOS Keychain <b>{state.googleLive.keychainAvailable ? 'ready' : 'unavailable'}</b></small>
            </div>
            <label>
              <span>School recipient</span>
              <input type="email" placeholder="teacher@school.org" value={liveGoogleRecipient} onChange={(event) => setLiveGoogleRecipient(event.target.value)} disabled={liveGoogleBusy} />
            </label>
            <button className="secondary-button" onClick={saveLiveGoogleRecipient} disabled={liveGoogleBusy || serviceStatus !== 'online'}>
              <ShieldCheck size={16} /> Save recipient
            </button>
            {!state.googleLive.connected ? (
              <button className="secondary-button" onClick={authorizeLiveGoogle} disabled={liveGoogleBusy || serviceStatus !== 'online' || !state.googleLive.enabled || !state.googleLive.clientConfigured || !state.googleLive.keychainAvailable}>
                <ShieldCheck size={16} /> Authorize Google
              </button>
            ) : (
              <button className="text-button danger" onClick={revokeLiveGoogle} disabled={liveGoogleBusy}>
                <X size={16} /> Revoke Google access
              </button>
            )}
            <button className="primary-button" onClick={deliverLiveGoogle} disabled={liveGoogleBusy || serviceStatus !== 'online' || !state.googleLive.enabled || !state.googleLive.connected || !liveGoogleRecipient}>
              <Send size={16} /> {liveGoogleBusy ? 'Working…' : 'Send this week now'}
            </button>
            {!state.googleLive.enabled && <p className="google-setup-note">Live calls remain blocked until the local service starts with <code>HOMEWORK_GOOGLE_MODE=live</code>.</p>}
            {state.googleLive.lastError && <p className="delivery-error google-setup-note">{state.googleLive.lastError}</p>}
            {liveGoogleMessage && <p className="google-proof-message" role="status">{liveGoogleMessage}</p>}
          </div>
          <div className="delivery-history">
            <div className="delivery-heading"><strong>Live delivery queue</strong><small>Restart-safe · one record per week</small></div>
            {state.googleLive.deliveries.length === 0 ? (
              <div className="completion-empty">No live deliveries yet. Only writing marked complete is eligible.</div>
            ) : state.googleLive.deliveries.slice(0, 5).map((delivery) => (
              <div className="delivery-row" key={delivery.id}>
                <span className={`delivery-icon ${delivery.status}`}><Send size={17} /></span>
                <span>
                  <strong>Week of {delivery.weekId}</strong>
                  <small>{delivery.draftCount} complete {delivery.draftCount === 1 ? 'draft' : 'drafts'} · {delivery.recipient} · attempt {delivery.attemptCount}</small>
                  <small>Share: {delivery.shareStatus}{delivery.nextAttemptAt ? ` · retry ${new Date(delivery.nextAttemptAt).toLocaleString()}` : ''}</small>
                  {delivery.lastError && <small className="delivery-error">{delivery.lastError}</small>}
                </span>
                <span className="delivery-actions">
                  <b className={`delivery-status ${delivery.status}`}>{delivery.status}</b>
                  {delivery.documentUrl && <a href={delivery.documentUrl} target="_blank" rel="noreferrer"><FileText size={14} /> Doc</a>}
                  {delivery.pdfUrl && <a href={delivery.pdfUrl}><Download size={14} /> PDF</a>}
                  {delivery.status === 'failed' && <button className="row-button" onClick={() => retryLiveGoogle(delivery.id)} disabled={liveGoogleBusy}>Retry</button>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="parent-panel completion-panel">
        <div className="panel-heading"><div><h3>Verified completion history</h3><p>How the service accepted each finished activity.</p></div><ShieldCheck size={20} /></div>
        {state.completionRecords.length === 0 ? (
          <div className="completion-empty">Completed controlled sessions will appear here with their verification source.</div>
        ) : (
          <div className="completion-list">
            {state.completionRecords.slice(0, 8).map((record) => {
              const activity = [...REQUIRED_ACTIVITIES, ...OPTIONAL_ACTIVITIES].find((item) => item.id === record.activityId)
              const method = record.method === 'time-in-session'
                ? 'Time-in-session'
                : record.method === 'self-reported'
                  ? 'Self-reported'
                  : record.method === 'parent-override'
                    ? 'Parent override'
                    : record.method === 'reward-playback'
                      ? 'Reward playback'
                    : record.method === 'game-verified'
                      ? 'Game-verified'
                      : 'Imported'
              return (
                <div className="completion-row" key={record.id}>
                  <span className="verified-check"><ShieldCheck size={17} /></span>
                  <span><strong>{activity?.title ?? (record.activityId.startsWith('session:') ? 'Reward time' : record.activityId)}</strong><small>{record.sessionKey ? `${record.sessionKey} · ` : ''}{new Date(record.completedAt).toLocaleString()}</small></span>
                  <b>{method}</b>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="danger-zone"><div><strong>Preview data</strong><p>Clear local progress and return to a fresh week.</p></div><button className="danger-button" onClick={reset}><RotateCcw size={16} /> Reset preview</button></div>
    </section>
  )
}

export default App
