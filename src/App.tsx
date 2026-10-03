import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
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
  getToday,
  getWeekLabel,
  inspectDraft,
  optionalSessionKey,
  progressForDay,
  type ActiveTimer,
  type AppState,
  type DayName,
  type Draft,
} from './domain'
import {
  acknowledgeControlledSession,
  endControlledSession,
  heartbeatControlledSession,
  hydrateFromService,
  recordAudit,
  saveStateToService,
  setDailyCompletion,
  startControlledSession,
  type ServiceMeta,
} from './service'

type View = 'path' | 'day' | 'options' | 'writing' | 'rewards' | 'parent' | 'session'

const STORAGE_KEY = 'fionnbar-homework-v1'

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultState
    const parsed = JSON.parse(saved) as Partial<AppState>
    return {
      ...defaultState,
      ...parsed,
      requiredByDay: { ...defaultState.requiredByDay, ...parsed.requiredByDay },
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
        .catch(() => setServiceStatus('offline'))
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
        const intent = response.session?.status === 'completed' ? false : sessionWantsRunning.current
        if (response.session?.status === 'completed') sessionWantsRunning.current = false
        setState({
          ...response.state,
          activeTimer: response.state.activeTimer
            ? { ...response.state.activeTimer, running: intent }
            : null,
        })
        setServiceMeta(response.meta)
        setServiceStatus('online')
        setSessionError('')
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
        const response = await setDailyCompletion(selectedDay, activityId, completed, 'self-reported')
        setState(response.state)
        setServiceMeta(response.meta)
        return
      } catch {
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
      sessionWantsRunning.current = true
      setState({
        ...response.state,
        activeTimer: response.session ? { ...response.session, running: true } : null,
      })
      setServiceMeta(response.meta)
      setSessionError('')
      setView('session')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'The controlled session could not start.')
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
          {view === 'path' && <PathView state={state} selectedDay={selectedDay} openDay={openDay} />}
          {view === 'day' && (
            <DayView
              state={state}
              day={selectedDay}
              setDay={setSelectedDay}
              toggleSelfReported={toggleSelfReported}
              startTimer={startTimer}
              openOptions={() => setView('options')}
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
        <p className="topbar-label">WEEK OF</p>
        <strong>{getWeekLabel()}</strong>
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
                  <span className="day-title-row"><strong>{day}</strong>{isToday && <b>TODAY</b>}</span>
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
  openOptions,
}: {
  state: AppState
  day: DayName
  setDay: (day: DayName) => void
  toggleSelfReported: (id: string) => void
  startTimer: (timer: ActiveTimer) => void
  openOptions: () => void
}) {
  const completed = state.requiredByDay[day]
  const progress = progressForDay(state, day)
  const free = dayIsComplete(state, day)
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
                <button className="row-button" onClick={() => startTimer({
                  kind: 'required', activityId: activity.id, sessionKey: day, label: activity.title,
                  totalSeconds: (activity.minutes ?? 0) * 60, remainingSeconds: (activity.minutes ?? 0) * 60, running: true,
                })}>Start <Play size={15} fill="currentColor" /></button>
              )}
              {activity.method === 'timer' && done && <span className="verified-check"><Check size={20} /></span>}
              {activity.method === 'verified' && !done && <span className="waiting-pill">Waiting for game</span>}
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

function OptionalView({ state, startTimer, onBack }: { state: AppState; startTimer: (timer: ActiveTimer) => void; onBack: () => void }) {
  return (
    <section className="page">
      <button className="text-button back-button" onClick={onBack}><ArrowLeft size={17} /> Back to week</button>
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">PRACTICE BANK</p>
          <h2>Choose your next session.</h2>
          <p>Finish sessions early and they count toward the whole week.</p>
        </div>
        <div className="big-score"><strong>{state.optionalCompleted.length}</strong><span>of 13<br />banked</span></div>
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

function WritingView({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const latest = state.drafts[0]
  const [title, setTitle] = useState(latest?.title ?? '')
  const [body, setBody] = useState(latest?.body ?? '')
  const [showReview, setShowReview] = useState(false)
  const findings = useMemo(() => inspectDraft(body), [body])

  const save = () => {
    if (!title.trim() && !body.trim()) return
    const draft: Draft = {
      id: latest?.id ?? crypto.randomUUID(),
      title: title.trim() || 'Untitled writing',
      body,
      updatedAt: new Date().toISOString(),
      findings,
    }
    setState((current) => ({ ...current, drafts: [draft, ...current.drafts.filter((item) => item.id !== draft.id)] }))
  }

  return (
    <section className="page writing-page">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">WRITING STUDIO</p><h2>Make your ideas clear.</h2><p>Your original words are always saved before review.</p></div>
        <div className="privacy-pill"><ShieldCheck size={18} /><span><strong>Private by design</strong><small>Checked on this Mac</small></span></div>
      </div>
      <div className="writing-grid">
        <div className="editor-card">
          <input className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give your writing a title…" spellCheck={false} />
          <textarea
            value={body}
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
              <div className="review-category"><span>ABC</span><p><strong>Capitalization</strong><small>Sentence starts and known names</small></p></div>
              <div className="review-category"><span>.,?</span><p><strong>Punctuation</strong><small>End marks and simple commas</small></p></div>
              <button className="primary-button full-button" disabled={!body.trim()} onClick={() => { save(); setShowReview(true) }}>Save & check my writing</button>
            </div>
          ) : (
            <div className="findings">
              <div className="findings-summary"><strong>{findings.length ? `${findings.length} practice ${findings.length === 1 ? 'idea' : 'ideas'}` : 'Nice careful writing!'}</strong><p>{findings.length ? 'These high-confidence rules are ready for practice.' : 'No supported issues were found in this draft.'}</p></div>
              {findings.map((finding) => (
                <div className="finding" key={finding.id}><span>{finding.category === 'Capitalization' ? 'Aa' : '.,?'}</span><div><small>{finding.category}</small><strong>{finding.message}</strong><p>{finding.suggestion}</p></div></div>
              ))}
              <button className="secondary-button full-button" onClick={() => setShowReview(false)}>Keep writing</button>
            </div>
          )}
        </aside>
      </div>
      <div className="integration-note"><Clock3 size={19} /><div><strong>Friday delivery is not connected yet.</strong><p>Google authorization and the spelling-practice module are required before writing can be sent.</p></div></div>
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
  const [displayRemaining, setDisplayRemaining] = useState(timer.remainingSeconds)
  useEffect(() => {
    setDisplayRemaining(timer.remainingSeconds)
    if (!timer.running || timer.status !== 'active' || timer.remainingSeconds <= 0) return
    const interval = window.setInterval(() => {
      setDisplayRemaining((current) => Math.max(0, current - 1))
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [timer.remainingSeconds, timer.running, timer.status])

  const elapsed = timer.totalSeconds - displayRemaining
  const percent = Math.min(100, (elapsed / timer.totalSeconds) * 100)
  const done = timer.status === 'completed'
  return (
    <section className="session-page">
      <div className="session-card">
        <div className="session-status"><span className={timer.running ? 'pulse' : ''} /> {done ? 'SESSION COMPLETE' : timer.running ? 'ACTIVE FOCUS TIME' : 'SESSION PAUSED'}</div>
        <div className="timer-ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{formatTimer(displayRemaining)}</strong><small>{displayRemaining === 0 && !done ? 'verifying' : 'remaining'}</small></div>
        </div>
        <p className="eyebrow">{timer.kind === 'reward' ? 'ENJOY YOUR REWARD' : 'CURRENT ACTIVITY'}</p>
        <h2>{timer.label}</h2>
        <p className="session-copy">{done ? 'You did it. Your progress is ready to save.' : timer.kind === 'reward' ? 'The playback connection will be added with the managed Chrome guardian.' : 'Keep this approved activity in front. Time pauses whenever you leave.'}</p>
        {!done ? (
          <div className="session-actions">
            <button className="secondary-button" onClick={toggle}>{timer.running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}{timer.running ? 'Pause' : 'Resume'}</button>
            <button className="text-button danger" onClick={cancel}><X size={17} /> End session</button>
          </div>
        ) : (
          <button className="primary-button" onClick={complete}><Check size={19} /> Return to learning path</button>
        )}
        <div className="focus-note"><ShieldCheck size={17} /> Server verified · checks focus every five seconds</div>
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
  const toggleOverride = async (activityId: string) => {
    const wasComplete = state.requiredByDay[day].includes(activityId)
    if (serviceStatus === 'online') {
      try {
        const response = await setDailyCompletion(day, activityId, !wasComplete, 'parent-override')
        setState(response.state)
        return
      } catch {
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
    setState({ ...defaultState, entered: true })
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
        <div><small>GUARDIAN</small><strong className={state.guardianConnected ? 'status-good' : 'status-warn'}>{state.guardianConnected ? 'Demo on' : 'Not linked'}</strong></div>
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
          <div className="panel-heading"><div><h3>System connections</h3><p>Feasibility work still required.</p></div></div>
          <div className="connection-row"><span className={serviceStatus === 'online' ? 'dot good' : 'dot'} /><div><strong>Local data service</strong><small>{serviceStatus === 'online' ? `SQLite schema ${serviceMeta?.schemaVersion ?? 1} · restart-safe` : 'Using browser backup storage'}</small></div>{serviceStatus === 'online' ? <b>Connected</b> : <button onClick={reconnectService}>Retry</button>}</div>
          <div className="connection-row"><span className={state.guardianConnected ? 'dot good' : 'dot'} /><div><strong>macOS guardian</strong><small>{state.guardianConnected ? 'Preview status enabled' : 'Not installed'}</small></div><button onClick={() => setState((current) => ({ ...current, guardianConnected: !current.guardianConnected }))}>{state.guardianConnected ? 'Turn off demo' : 'Demo status'}</button></div>
          <div className="connection-row"><span className="dot" /><div><strong>Managed Chrome</strong><small>Policy not installed</small></div><b>Pending</b></div>
          <div className="connection-row"><span className="dot" /><div><strong>Google delivery</strong><small>OAuth not authorized</small></div><b>Pending</b></div>
          <div className="connection-row"><span className="dot" /><div><strong>Reading game</strong><small>Completion origin needed</small></div><b>Pending</b></div>
          <button className="secondary-button full-button" onClick={addCredit}><Plus size={17} /> Add a 5-minute credit</button>
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
