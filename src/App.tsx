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
  OPTIONAL_TARGETS,
  REQUIRED_ACTIVITIES,
  activeRequiredActivities,
  dayIsComplete,
  defaultState,
  formatTimer,
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
} from './domain'
import {
  advanceFindingProgress,
  applyCompletedCorrections,
  inspectAmbiguousDraft,
  inspectDraft,
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
  beginLiveGoogleAuthorization,
  connectMockGoogle,
  disconnectLiveGoogle,
  disconnectMockGoogle,
  endControlledSession,
  heartbeatControlledSession,
  hydrateFromService,
  getReadingGameSession,
  loadStateFromService,
  recordAudit,
  retryLiveGoogleDelivery,
  runLiveGoogleDelivery,
  runMockGoogleDelivery,
  saveActivityConfiguration,
  saveLiveGoogleConfiguration,
  saveStateToService,
  setDailyCompletion,
  startControlledSession,
  startReadingGame as startReadingGameSession,
  ServiceRequestError,
  type ServiceMeta,
} from './service'

type View = 'path' | 'day' | 'options' | 'writing' | 'rewards' | 'parent' | 'session'

const STORAGE_KEY = 'fionnbar-homework-v1'

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

function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [view, setView] = useState<View>(state.activeTimer ? 'session' : 'path')
  const [selectedDay, setSelectedDay] = useState<DayName>(getToday)
  const [serviceStatus, setServiceStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [serviceMeta, setServiceMeta] = useState<ServiceMeta | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [sessionError, setSessionError] = useState('')
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
    const gameSessionId = state.activeGameSession?.id
    if (!gameSessionId || serviceStatus !== 'online') return
    let cancelled = false
    const refresh = () => {
      getReadingGameSession(gameSessionId)
        .then(({ state: storedState, meta }) => {
          if (cancelled) return
          setState(storedState)
          setServiceMeta(meta)
          setSessionError('')
        })
        .catch((error) => {
          if (cancelled) return
          setSessionError(error instanceof Error ? error.message : 'The game status could not be checked.')
        })
    }
    const interval = window.setInterval(refresh, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [state.activeGameSession?.id, serviceStatus])

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

    const gameWindow = window.open('', 'reading-strategies-game', 'popup,width=900,height=720')
    if (!gameWindow) {
      setSessionError('Allow pop-ups for this app so the Reading Strategies game can open.')
      return
    }

    try {
      const response = await startReadingGameSession(day)
      setState(response.state)
      setServiceMeta(response.meta)
      setSessionError('')
      gameWindow.location.href = response.gameSession.launchUrl
      gameWindow.focus()
    } catch (error) {
      gameWindow.close()
      setSessionError(error instanceof Error ? error.message : 'The Reading Strategies game could not start.')
    }
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

  if (!state.entered) {
    return (
      <EntryScreen
        onEnter={() => {
          setState((current) => ({ ...current, entered: true }))
          setView('path')
        }}
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
          {view === 'path' && (
            state.weekContext.headStart
              ? <OptionalView state={state} startTimer={startTimer} headStart />
              : <PathView state={state} selectedDay={selectedDay} openDay={openDay} />
          )}
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
          {view === 'writing' && <WritingView state={state} setState={setState} />}
          {view === 'rewards' && <RewardsView state={state} startTimer={startTimer} />}
          {view === 'parent' && (
            <ParentView
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

function EntryScreen({ onEnter }: { onEnter: () => void }) {
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
        <button className="primary-button enter-button" onClick={onEnter}>
          Enter this week <ChevronRight size={20} />
        </button>
        <p className="entry-note"><ShieldCheck size={14} /> Homework mode begins when you enter</p>
      </section>
    </main>
  )
}

function Sidebar({ view, navigate, rewardCount }: { view: View; navigate: (view: View) => void; rewardCount: number }) {
  const items: { id: View; label: string; icon: typeof Home }[] = [
    { id: 'path', label: 'Week', icon: Home },
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
          <div><small>WEEKLY PRACTICE</small><strong>{optionalTotal} <span>/ 13 banked</span></strong></div>
        </div>
      </div>

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
          const needsExternalSetup = activity.id === 'ninja-dojo'
          const externalReady = !needsExternalSetup || state.activityConfiguration.ninjaDojo.ready
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
                  {gamePending ? 'Restart game' : 'Launch game'} <Play size={15} fill="currentColor" />
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
        <span><small>WEEKLY PRACTICE BANK</small><strong>{state.optionalCompleted.length} of 13 sessions complete</strong></span>
        <span className="banner-progress"><span style={{ width: `${(state.optionalCompleted.length / 13) * 100}%` }} /></span>
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
        <p>Friday’s work is complete, all 13 practice sessions are banked, and Free Mode is unlocked.</p>
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
        <div className="big-score"><strong>{state.optionalCompleted.length}</strong><span>of 13<br />banked</span></div>
      </div>
      <div className="practice-grid">
        {OPTIONAL_ACTIVITIES.map((activity) => {
          const completedCount = Array.from({ length: activity.sessions }).filter((_, index) => state.optionalCompleted.includes(optionalSessionKey(activity.id, index))).length
          const configuration = activity.id === 'du-chinese'
            ? state.activityConfiguration.duChinese
            : activity.id === 'level-chinese'
              ? state.activityConfiguration.levelChinese
              : null
          const canStart = !configuration || configuration.ready
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
                    <button key={key} className={done ? 'segment done' : 'segment'} disabled={done || !canStart} title={!configuration?.ready ? 'Parent setup is required' : configuration && !state.chromeConnected ? 'Managed Chrome is checked when the session starts' : undefined} onClick={() => startTimer({
                      kind: 'optional', activityId: activity.id, sessionKey: key,
                      label: `${activity.title} · Session ${index + 1}`,
                      totalSeconds: activity.minutes * 60, remainingSeconds: activity.minutes * 60, running: true,
                    })}>
                      {done ? <Check size={17} /> : <span>{index + 1}</span>}
                    </button>
                  )
                })}
              </div>
              <small className="card-foot">{completedCount === activity.sessions ? 'All sessions banked' : !configuration ? `${activity.sessions - completedCount} left this week` : !configuration.ready ? 'Parent setup required' : !state.chromeConnected ? 'Managed Chrome required at launch' : `${activity.sessions - completedCount} left this week`}</small>
            </article>
          )
        })}
      </div>
      <div className="head-start-note"><Sparkles size={20} /><div><strong>Get a Head Start</strong><p>The next practice week opens every Sunday at 4:00 a.m.</p></div></div>
    </section>
  )
}

function WritingView({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const latest = state.drafts[0]
  const [title, setTitle] = useState(latest?.title ?? '')
  const [body, setBody] = useState(latest?.body ?? '')
  const [showReview, setShowReview] = useState(false)
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(latest?.id ?? null)
  const [answerMessage, setAnswerMessage] = useState('')
  const [spellingAnswer, setSpellingAnswer] = useState('')
  const analysis = useMemo(() => ({
    findings: inspectDraft(body, state.writingDictionary),
    reviewItems: inspectAmbiguousDraft(body),
    spellingWords: inspectSpelling(body, state.writingDictionary),
  }), [body, state.writingDictionary])
  const findings = analysis.findings
  const reviewDraft = state.drafts.find((draft) => draft.id === reviewDraftId)
  const reviewFindings = reviewDraft?.findings ?? findings
  const reviewProgress = reviewDraft?.exerciseProgress ?? {}
  const legacySpellingNeedsAnalysis = reviewDraft?.reviewStatus === 'spelling-pending' &&
    (reviewDraft.spellingWords?.length ?? 0) === 0
  const reviewSpellingWords = legacySpellingNeedsAnalysis && reviewDraft
    ? inspectSpelling(reviewDraft.body, state.writingDictionary)
    : reviewDraft?.spellingWords ?? analysis.spellingWords
  const reviewSpellingProgress = reviewDraft?.spellingProgress ?? {}
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
  const totalExerciseSteps = reviewFindings.length * 6
  const completedExerciseSteps = reviewFindings.reduce((total, finding) => {
    const progress = reviewProgress[finding.id]
    return total + (progress?.correctionComplete ? 1 : 0) + Math.min(5, progress?.practiceCompleted ?? 0)
  }, 0)
  const totalSpellingSteps = reviewSpellingWords.length * 9
  const spellingStepsComplete = completedSpellingSteps(reviewSpellingWords, reviewSpellingProgress)

  useEffect(() => {
    setAnswerMessage('')
    setSpellingAnswer('')
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

  const save = () => {
    if (!title.trim() && !body.trim()) return
    const draft: Draft = {
      id: latest?.id ?? crypto.randomUUID(),
      title: title.trim() || 'Untitled writing',
      body,
      correctedBody: body,
      updatedAt: new Date().toISOString(),
      findings,
      exerciseProgress: {},
      spellingWords: analysis.spellingWords,
      spellingProgress: {},
      reviewStatus: writingReviewStatus(findings, {}, analysis.spellingWords, {}),
    }
    const createdAt = new Date().toISOString()
    setState((current) => {
      const existing = new Map(current.writingReviewQueue.map((item) => [item.id, item]))
      const reviewItems = analysis.reviewItems.map((item) => {
        const id = `${draft.id}:${item.id}`
        return existing.get(id) ?? {
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
    setReviewDraftId(draft.id)
    setShowReview(true)
  }

  const chooseAnswer = (choice: string) => {
    if (!reviewDraft || !activeFinding || !activeProgress || !activeTrial) return
    const correct = choice === activeTrial.correctAnswer
    const nextItem = advanceFindingProgress(activeProgress, correct, activeFinding.practice.length)
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
            ),
            updatedAt: new Date().toISOString(),
          }
        : draft),
    }))
    setAnswerMessage(correct ? 'Correct! Keep going.' : 'Try again. That answer does not advance your practice count.')
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
            ),
            updatedAt: new Date().toISOString(),
          }
        : draft),
    }))
    setAnswerMessage(result.correct ? 'Correct! That spelling response counts.' : 'Try again. Listen once more—the counter did not advance.')
    if (result.correct) setSpellingAnswer('')
  }

  return (
    <section className="page writing-page">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">WRITING STUDIO</p><h2>Make your ideas clear.</h2><p>Your original words are always saved before review.</p></div>
        <div className="privacy-pill"><ShieldCheck size={18} /><span><strong>Private by design</strong><small>Checked on this Mac</small></span></div>
      </div>
      <div className="writing-grid">
        <div className="editor-card">
          <input className="title-input" value={title} disabled={showReview} onChange={(event) => setTitle(event.target.value)} placeholder="Give your writing a title…" spellCheck={false} />
          <textarea
            value={body}
            disabled={showReview}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Start writing here…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Writing draft"
          />
          <div className="editor-footer"><span>{body.trim() ? body.trim().split(/\s+/).length : 0} words</span><span>Hints are off · Your work stays yours</span></div>
        </div>
        <aside className="review-card">
          <div className="review-heading"><span className="review-icon"><Sparkles size={20} /></span><div><h3>Ready to review?</h3><p>We’ll look for rules we know well.</p></div></div>
          {!showReview ? (
            <div className="review-empty">
              <div className="review-category"><span>✓</span><p><strong>Grammar</strong><small>Agreement, articles, and basic tense</small></p></div>
              <div className="review-category"><span>ABC</span><p><strong>Capitalization</strong><small>Sentence starts and known names</small></p></div>
              <div className="review-category"><span>.,?</span><p><strong>Punctuation</strong><small>End marks and simple commas</small></p></div>
              <div className="review-category"><span>ABC</span><p><strong>Spelling</strong><small>Reviewed common misspellings only</small></p></div>
              <button className="primary-button full-button" disabled={!body.trim()} onClick={save}>Save & check my writing</button>
            </div>
          ) : activeFinding && activeTrial ? (
            <div className="writing-exercise">
              <div className="exercise-progress">
                <span>{completedExerciseSteps} of {totalExerciseSteps} steps</span>
                <div><i style={{ width: `${totalExerciseSteps ? (completedExerciseSteps / totalExerciseSteps) * 100 : 100}%` }} /></div>
              </div>
              <small className="exercise-category">{activeFinding.category} · {activeProgress?.correctionComplete ? `practice ${Math.min(5, (activeProgress?.practiceCompleted ?? 0) + 1)} of 5` : 'your sentence'}</small>
              <h4>{activeFinding.message}</h4>
              <p>{activeTrial.prompt}</p>
              <div className="exercise-choices">
                {activeTrial.choices.map((choice) => (
                  <button key={choice} onClick={() => chooseAnswer(choice)}>{choice}</button>
                ))}
              </div>
              {answerMessage && <p className={answerMessage.startsWith('Correct') ? 'answer-message correct' : 'answer-message'} aria-live="polite">{answerMessage}</p>}
              <button className="text-button" onClick={() => setShowReview(false)}>Return to draft</button>
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
              <button className="text-button" type="button" onClick={() => setShowReview(false)}>Return to draft</button>
            </form>
          ) : (
            <div className="writing-complete">
              <span><Check size={24} /></span>
              <h3>{reviewFindings.length || reviewSpellingWords.length ? 'Writing practice complete!' : 'No supported issues found.'}</h3>
              <p>Your untouched original and corrected copy are saved separately.</p>
              {reviewDraft?.correctedBody && <div className="corrected-preview">{reviewDraft.correctedBody}</div>}
              <div className="spelling-complete"><Check size={16} /><p><strong>Ready for Friday delivery.</strong> Every supported correction and spelling exercise is complete.</p></div>
              <button className="secondary-button full-button" onClick={() => setShowReview(false)}>Keep writing</button>
            </div>
          )}
        </aside>
      </div>
      <div className="integration-note"><Clock3 size={19} /><div><strong>Completed writing is ready for Friday.</strong><p>Safe test mode stays local. When a parent enables and authorizes live Google delivery, only writing that finishes every supported exercise can be sent.</p></div></div>
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

function ParentView({
  state,
  setState,
  day,
  setDay,
  serviceStatus,
  serviceMeta,
  reconnectService,
}: {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  day: DayName
  setDay: (day: DayName) => void
  serviceStatus: 'connecting' | 'online' | 'offline'
  serviceMeta: ServiceMeta | null
  reconnectService: () => void
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

  const saveWritingConfiguration = () => {
    const writingDictionary = {
      knownNames: parseDictionary(knownNames),
      knownPlaces: parseDictionary(knownPlaces),
    }
    setState((current) => ({ ...current, writingDictionary }))
    setWritingConfigurationMessage('The local names and places dictionary was saved. Recheck a draft to apply it.')
    void recordAudit('writing_dictionary_updated', {
      knownNames: writingDictionary.knownNames.length,
      knownPlaces: writingDictionary.knownPlaces.length,
    }).catch(() => {})
  }

  const toggleWritingReview = (id: string) => {
    const resolved = state.writingReviewQueue.find((item) => item.id === id)?.status === 'pending'
    setState((current) => ({
      ...current,
      writingReviewQueue: current.writingReviewQueue.map((item) => {
        if (item.id !== id) return item
        return {
          ...item,
          status: resolved ? 'resolved' : 'pending',
          ...(resolved ? { resolvedAt: new Date().toISOString() } : { resolvedAt: undefined }),
        }
      }),
    }))
    void recordAudit('writing_review_status_changed', { reviewId: id, resolved }).catch(() => {})
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
    if (serviceStatus === 'online') {
      try {
        const response = await setDailyCompletion(
          day,
          activityId,
          !wasComplete,
          'parent-override',
          state.weekContext.weekId,
        )
        setState(response.state)
        return
      } catch (error) {
        if (isStaleWeekError(error)) {
          const response = await loadStateFromService()
          setState(response.state)
          return
        }
        // Keep the preview usable from browser storage if the service drops out.
      }
    }
    setState((current) => {
      const completed = current.requiredByDay[day]
      return {
        ...current,
        requiredByDay: {
          ...current.requiredByDay,
          [day]: completed.includes(activityId) ? completed.filter((id) => id !== activityId) : [...completed, activityId],
        },
      }
    })
  }
  const addCredit = () => {
    const creditId = crypto.randomUUID()
    setState((current) => ({
      ...current,
      rewardCredits: [...current.rewardCredits, { id: creditId, source: 'Parent-added credit', remainingSeconds: 300, earnedAt: new Date().toISOString() }],
    }))
    void recordAudit('parent_reward_credit_added', { creditId, seconds: 300 }).catch(() => {})
  }
  const reset = () => {
    if (!window.confirm('Reset all preview progress on this Mac? This cannot be undone.')) return
    void recordAudit('parent_preview_reset', { previousDrafts: state.drafts.length }).catch(() => {})
    setState({
      ...structuredClone(defaultState),
      entered: true,
      activityConfiguration: state.activityConfiguration,
      weekContext: state.weekContext,
    })
  }
  return (
    <section className="page parent-page">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">PARENT DASHBOARD · PREVIEW</p><h2>See what’s happening.</h2><p>Production controls will require macOS administrator authorization.</p></div>
        <div className="admin-pill"><CircleUserRound size={20} /><span><small>LOCAL PREVIEW</small><strong>Parent controls</strong></span></div>
      </div>
      <div className="parent-stats">
        <div><small>WEEKLY PRACTICE</small><strong>{state.optionalCompleted.length}<span>/13</span></strong></div>
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
          <div><h3>Writing review tools</h3><p>Teach the local checker known capitalization and review ambiguous, non-blocking suggestions.</p></div>
          <span className="mock-badge">{state.writingReviewQueue.filter((item) => item.status === 'pending').length} TO REVIEW</span>
        </div>
        <div className="writing-tools-grid">
          <div className="writing-dictionary-form">
            <label><span>Known names</span><textarea rows={5} value={knownNames} onChange={(event) => setKnownNames(event.target.value)} placeholder={'Fionnbar\nTeacher name'} /></label>
            <label><span>Known places</span><textarea rows={5} value={knownPlaces} onChange={(event) => setKnownPlaces(event.target.value)} placeholder={'San Francisco\nSchool name'} /></label>
            <p>Use one name or place per line. The saved capitalization becomes the required form during the next draft check.</p>
            <button className="primary-button" onClick={saveWritingConfiguration}><BookOpen size={16} /> Save writing dictionary</button>
            {writingConfigurationMessage && <p className="google-proof-message" role="status">{writingConfigurationMessage}</p>}
          </div>
          <div className="writing-review-list">
            <div className="delivery-heading"><strong>Ambiguous findings</strong><small>These never block writing practice</small></div>
            {state.writingReviewQueue.length === 0 ? (
              <div className="completion-empty">No ambiguous writing findings are waiting for parent review.</div>
            ) : state.writingReviewQueue.slice().reverse().slice(0, 10).map((item) => (
              <div className={`writing-review-row ${item.status}`} key={item.id}>
                <span><strong>{item.category}</strong><small>{item.status}</small></span>
                <div><strong>{item.message}</strong><p>{item.excerpt}</p></div>
                <button className="row-button" onClick={() => toggleWritingReview(item.id)}>{item.status === 'pending' ? 'Mark reviewed' : 'Reopen'}</button>
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
          <div><h3>Live Friday Google delivery</h3><p>Creates the weekly Google Doc, exports a verified PDF, shares view-only, and emails the school recipient after Friday at 4 p.m.</p></div>
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
