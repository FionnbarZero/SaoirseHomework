// Mode is supplied by the server deployment, never by a browser request.
export function buildRewardSession({ credit, mode = 'managed', chromeConnected = false }) {
  if (!credit || credit.remainingSeconds <= 0) throw new Error('Reward credit not found')
  const honor = mode === 'honor'
  if (!honor && !chromeConnected) {
    throw Object.assign(new Error('Managed Chrome must be connected before YouTube reward time can start'), {
      status: 409, code: 'managed_chrome_required',
    })
  }
  const origins = ['https://youtube.com', 'https://www.youtube.com', 'https://m.youtube.com', 'https://music.youtube.com']
  return {
    kind: 'reward',
    activityId: credit.id,
    label: 'YouTube reward',
    targetSeconds: credit.remainingSeconds,
    ...(!honor ? { selectionSeconds: 120 } : {}),
    plan: {
      phases: [{
        id: honor ? 'youtube-honor' : 'youtube-playback',
        label: honor ? 'YouTube' : 'YouTube playback',
        targetSeconds: credit.remainingSeconds,
        launchUrl: 'https://www.youtube.com/',
        allowedOrigins: origins,
        creditOrigins: origins,
        advanceOrigins: [],
        verification: honor ? 'self-timed' : 'youtube-playback',
      }],
    },
  }
}
