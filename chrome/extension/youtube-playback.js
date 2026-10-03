const PLAYBACK_REPORT_INTERVAL_MS = 2_000

function readPlaybackState() {
  const video = document.querySelector('video.html5-main-video, video')
  const player = document.querySelector('#movie_player')
  const adPlaying = Boolean(
    player?.classList.contains('ad-showing') ||
    document.querySelector('.ytp-ad-player-overlay, .video-ads.ytp-ad-module > :not(:empty)'),
  )
  const playbackActive = Boolean(
    video &&
    document.visibilityState === 'visible' &&
    !video.paused &&
    !video.ended &&
    video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
    !adPlaying,
  )
  return {
    type: 'youtubePlayback',
    playbackActive,
    adPlaying,
    videoId: new URL(location.href).searchParams.get('v'),
    reportedAt: Date.now(),
  }
}

function reportPlayback() {
  void chrome.runtime.sendMessage(readPlaybackState()).catch(() => {})
}

for (const eventName of ['play', 'pause', 'playing', 'waiting', 'ended', 'emptied']) {
  document.addEventListener(eventName, reportPlayback, true)
}
document.addEventListener('visibilitychange', reportPlayback)
setInterval(reportPlayback, PLAYBACK_REPORT_INTERVAL_MS)
reportPlayback()
