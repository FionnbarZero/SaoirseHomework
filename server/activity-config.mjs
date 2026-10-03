const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const MAX_ALLOWED_ORIGINS = 20

export function emptyActivityConfiguration() {
  return {
    ninjaDojo: { launchUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
    duChinese: { readingUrl: '', flashcardUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
    levelChinese: { cleverUrl: '', learningUrl: '', redirectOrigins: [], allowedOrigins: [], ready: false },
  }
}

function configurationError(message, code = 'invalid_activity_configuration') {
  const error = new Error(message)
  error.status = 400
  error.code = code
  return error
}

function normalizeUrl(value, label) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  let url
  try {
    url = new URL(text)
  } catch {
    throw configurationError(`${label} must be a valid URL`)
  }
  const secure = url.protocol === 'https:'
  const loopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (!secure && !loopback) {
    throw configurationError(`${label} must use HTTPS (HTTP is allowed only for loopback testing)`)
  }
  if (url.username || url.password) throw configurationError(`${label} cannot contain a username or password`)
  return url.toString()
}

function originFromUrl(value) {
  return value ? new URL(value).origin : ''
}

function normalizeAllowedOrigins(value, launchUrls) {
  if (value != null && !Array.isArray(value)) {
    throw configurationError('Approved origins must be a list')
  }
  const origins = new Set(launchUrls.filter(Boolean).map(originFromUrl))
  for (const entry of value ?? []) {
    const normalized = normalizeUrl(entry, 'Approved origin')
    if (normalized) origins.add(originFromUrl(normalized))
  }
  if (origins.size > MAX_ALLOWED_ORIGINS) {
    throw configurationError(`No more than ${MAX_ALLOWED_ORIGINS} approved origins are allowed per activity`)
  }
  return [...origins]
}

export function normalizeActivityConfiguration(input = {}) {
  const defaults = emptyActivityConfiguration()
  const ninjaInput = input.ninjaDojo ?? defaults.ninjaDojo
  const duInput = input.duChinese ?? defaults.duChinese
  const levelInput = input.levelChinese ?? defaults.levelChinese

  const ninjaLaunchUrl = normalizeUrl(ninjaInput.launchUrl, 'Ninja Dojo launch URL')
  const ninjaLaunchOrigins = [ninjaLaunchUrl].filter(Boolean).map(originFromUrl)
  const ninjaRedirects = normalizeAllowedOrigins(
    ninjaInput.redirectOrigins ?? (ninjaInput.allowedOrigins ?? []).filter((origin) => !ninjaLaunchOrigins.includes(originFromUrl(normalizeUrl(origin, 'Approved origin')))),
    [],
  )
  const ninjaOrigins = normalizeAllowedOrigins(ninjaRedirects, [ninjaLaunchUrl])

  const duReadingUrl = normalizeUrl(duInput.readingUrl, 'Du Chinese reading URL')
  const duFlashcardUrl = normalizeUrl(duInput.flashcardUrl, 'Du Chinese flashcard URL')
  const duLaunchOrigins = [duReadingUrl, duFlashcardUrl].filter(Boolean).map(originFromUrl)
  const duRedirects = normalizeAllowedOrigins(
    duInput.redirectOrigins ?? (duInput.allowedOrigins ?? []).filter((origin) => !duLaunchOrigins.includes(originFromUrl(normalizeUrl(origin, 'Approved origin')))),
    [],
  )
  const duOrigins = normalizeAllowedOrigins(duRedirects, [duReadingUrl, duFlashcardUrl])

  const levelCleverUrl = normalizeUrl(levelInput.cleverUrl, 'Clever login URL')
  const levelLearningUrl = normalizeUrl(levelInput.learningUrl, 'Level Learning URL')
  const levelLaunchOrigins = [levelCleverUrl, levelLearningUrl].filter(Boolean).map(originFromUrl)
  const levelRedirects = normalizeAllowedOrigins(
    levelInput.redirectOrigins ?? (levelInput.allowedOrigins ?? []).filter((origin) => !levelLaunchOrigins.includes(originFromUrl(normalizeUrl(origin, 'Approved origin')))),
    [],
  )
  const levelOrigins = normalizeAllowedOrigins(levelRedirects, [levelCleverUrl, levelLearningUrl])

  return {
    ninjaDojo: {
      launchUrl: ninjaLaunchUrl,
      redirectOrigins: ninjaRedirects,
      allowedOrigins: ninjaOrigins,
      ready: Boolean(ninjaLaunchUrl),
    },
    duChinese: {
      readingUrl: duReadingUrl,
      flashcardUrl: duFlashcardUrl,
      redirectOrigins: duRedirects,
      allowedOrigins: duOrigins,
      ready: Boolean(duReadingUrl && duFlashcardUrl),
    },
    levelChinese: {
      cleverUrl: levelCleverUrl,
      learningUrl: levelLearningUrl,
      redirectOrigins: levelRedirects,
      allowedOrigins: levelOrigins,
      ready: Boolean(levelCleverUrl && levelLearningUrl),
    },
  }
}

function notConfigured(label) {
  const error = new Error(`${label} needs parent-approved URLs before it can start`)
  error.status = 409
  error.code = 'activity_not_configured'
  return error
}

export function buildActivitySessionPlan(activityId, configuration) {
  const config = normalizeActivityConfiguration(configuration)
  if (activityId === 'ninja-dojo') {
    if (!config.ninjaDojo.ready) throw notConfigured('Ninja Dojo')
    return {
      targetSeconds: 17 * 60,
      phases: [{
        id: 'learning-hub',
        label: '5th Grade Learning Hub',
        targetSeconds: 17 * 60,
        launchUrl: config.ninjaDojo.launchUrl,
        allowedOrigins: config.ninjaDojo.allowedOrigins,
        creditOrigins: config.ninjaDojo.allowedOrigins,
        verification: 'managed-chrome',
      }],
    }
  }

  if (activityId === 'du-chinese') {
    if (!config.duChinese.ready) throw notConfigured('Du Chinese')
    const readingOrigin = originFromUrl(config.duChinese.readingUrl)
    const flashcardOrigin = originFromUrl(config.duChinese.flashcardUrl)
    return {
      targetSeconds: 20 * 60,
      phases: [
        {
          id: 'reading',
          label: 'Reading',
          targetSeconds: 13 * 60,
          launchUrl: config.duChinese.readingUrl,
          allowedOrigins: config.duChinese.allowedOrigins,
          creditOrigins: [readingOrigin],
          verification: 'managed-chrome',
        },
        {
          id: 'flashcards',
          label: 'Flashcards',
          targetSeconds: 7 * 60,
          launchUrl: config.duChinese.flashcardUrl,
          allowedOrigins: config.duChinese.allowedOrigins,
          creditOrigins: [flashcardOrigin],
          verification: 'managed-chrome',
          navigateOnStart: true,
        },
      ],
    }
  }

  if (activityId === 'level-chinese') {
    if (!config.levelChinese.ready) throw notConfigured('Level Chinese')
    const learningOrigin = originFromUrl(config.levelChinese.learningUrl)
    return {
      targetSeconds: 20 * 60,
      phases: [
        {
          id: 'clever-login',
          label: 'Log in through Clever',
          targetSeconds: 0,
          launchUrl: config.levelChinese.cleverUrl,
          allowedOrigins: config.levelChinese.allowedOrigins,
          creditOrigins: [],
          advanceOrigins: [learningOrigin],
          verification: 'managed-chrome',
        },
        {
          id: 'level-learning',
          label: 'Level Learning',
          targetSeconds: 20 * 60,
          launchUrl: config.levelChinese.learningUrl,
          allowedOrigins: config.levelChinese.allowedOrigins,
          creditOrigins: [learningOrigin],
          verification: 'managed-chrome',
        },
      ],
    }
  }

  return null
}
