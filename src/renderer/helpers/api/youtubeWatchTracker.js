/**
 * Create a best-effort TV OAuth watch reporter using the chosen player's tracking URLs.
 * Only YouTube's expected stats URLs are allowed: youtubei.js's HTTP client can
 * attach OAuth credentials to absolute URLs. Never allow redirects or arbitrary hosts.
 * Calls are driven by actual player timeupdate events, not a background timer.
 */
export function createYouTubeWatchTracker({ session, tracking, cpn, isActive, now = () => Date.now() }) {
  function safeStatsUrl(raw, path) {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || !['www.youtube.com', 's.youtube.com'].includes(url.hostname) ||
        url.port || url.username || url.password || url.pathname !== path) return null
      url.hostname = 'www.youtube.com'
      return url
    } catch {
      return null
    }
  }

  const playback = safeStatsUrl(tracking?.videostatsPlaybackUrl?.baseUrl, '/api/stats/playback')
  const watchtime = safeStatsUrl(tracking?.videostatsWatchtimeUrl?.baseUrl, '/api/stats/watchtime')
  if (!playback || !watchtime || !cpn || !session?.http?.fetch) return null

  let playbackSent = false
  let lastRequestAt = 0
  let startTime = null
  let lastPosition = null
  let pending = false

  async function update(position) {
    if (!isActive() || pending || !Number.isFinite(position) || position < 0) return
    const time = now()
    if (lastPosition !== null && (position < lastPosition || position - lastPosition > 5)) startTime = position
    lastPosition = position
    startTime ??= position
    if (lastRequestAt && time - lastRequestAt < 45000) return
    const isPlayback = !playbackSent
    const url = new URL(isPlayback ? playback : watchtime)
    const client = session.context.client
    url.searchParams.set('cpn', cpn)
    url.searchParams.set('ver', '2')
    url.searchParams.set('c', client.clientName.toLowerCase())
    url.searchParams.set('cver', client.clientVersion)
    url.searchParams.set('cbrver', client.clientVersion)
    url.searchParams.set('cmt', position.toFixed(3))
    if (!isPlayback) {
      url.searchParams.set('st', startTime.toFixed(3))
      url.searchParams.set('et', position.toFixed(3))
      url.searchParams.set('final', '0')
    }
    // Rate-limit failures too, and don't retry indefinitely when paused.
    pending = true
    lastRequestAt = time
    try {
      await session.http.fetch(url, { redirect: 'error' })
      if (isPlayback) playbackSent = true
      startTime = position
    } catch {
      // This is best-effort and must never interfere with local watch history.
    } finally {
      pending = false
    }
  }

  return { update }
}
