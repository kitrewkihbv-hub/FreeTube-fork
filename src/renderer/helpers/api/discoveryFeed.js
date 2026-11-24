/** Detect live status only from explicit video badges, not titles or recommendations in menus. */
export function hasLiveBadge(item) {
  const seen = new Set()
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 16 || seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) return value.some(child => visit(child, depth + 1))
    if (value.is_live === true || value.isLive === true || value.isLiveNow === true || value.liveNow === true) return true
    if ([value.style, value.badgeStyle, value.badge_style, value.iconType, value.icon_name]
      .some(style => typeof style === 'string' && /^(LIVE|LIVE_NOW|BADGE_STYLE_TYPE_LIVE_NOW|THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE)$/.test(style))) return true
    return Object.entries(value).some(([key, child]) =>
      !/^(menu|navigationEndpoint|serviceEndpoint|onTap|onSelectCommand|rendererContext|trackingParams)$/.test(key) && visit(child, depth + 1))
  }
  return visit(item)
}

// Each timed-out source stops blocking refresh. The request itself may finish later.
function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Discovery request timed out')), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Select recent watched titles, giving frequently watched channels more weight. */
export function getInterestQueries(history, offset = 0) {
  const entries = (Array.isArray(history) ? history : []).slice(0, 100)
    .filter(item => typeof item?.title === 'string' && item.title.trim().length >= 4)
  const counts = new Map()
  for (const item of entries) {
    const key = item.authorId || item.author || item.videoId
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ranked = entries.map((item, index) => ({ item, index, weight: counts.get(item.authorId || item.author || item.videoId) ?? 1 }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  const seen = new Set()
  const queries = ranked.map(({ item }) => item.title.trim().slice(0, 120))
    .filter(title => {
      const key = title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 24)
  if (!queries.length) return []
  return Array.from({ length: Math.min(2, queries.length) }, (_, i) => queries[(offset + i) % queries.length])
}

/** Browse home recommendations and related searches based only on watched titles. */
export function createDiscoveryBrowser({ open, search, getHistory = () => [], kind = 'discover', timeoutMs = 12000 }) {
  let currentFeed = null
  let pool = []
  let recentIds = []
  let queryOffset = 0
  let homeAvailable = true

  async function readHome() {
    let feed
    if (currentFeed?.has_continuation) {
      try {
        feed = await currentFeed.getContinuation()
      } catch {
        feed = await open(kind)
      }
    } else {
      feed = await open(kind)
    }
    return { videos: feed?.videos ?? [], feed }
  }

  async function refresh() {
    const history = getHistory() ?? []
    const queries = getInterestQueries(history, queryOffset)
    queryOffset += queries.length
    const sources = [withTimeout(readHome(), timeoutMs)]
    if (search) {
      for (const query of queries) sources.push(withTimeout(Promise.resolve().then(() => search(query)), timeoutMs))
    }
    const settled = await Promise.allSettled(sources)
    const home = settled[0]
    if (home.status === 'fulfilled') currentFeed = home.value.feed
    homeAvailable = home.status === 'fulfilled' && home.value.videos.length > 0
    const homeVideos = home.status === 'fulfilled' ? home.value.videos : []
    const related = settled.slice(1).flatMap(result => result.status === 'fulfilled' ? result.value ?? [] : [])
    const watched = new Set(history.map(item => item.videoId).filter(Boolean))
    const valid = video => video?.type === 'video' && video.videoId && !watched.has(video.videoId)
    const homeResults = homeVideos.filter(valid)
    const relatedResults = related.filter(valid)
    if (!homeResults.length && !relatedResults.length) throw new Error('No readable recommendations were returned.')

    // Preserve YouTube's ranking and blend in related results without drowning it out.
    const collected = []
    for (let i = 0; i < Math.max(homeResults.length, relatedResults.length); i++) {
      if (homeResults[i]) collected.push(homeResults[i])
      if (relatedResults[i]) collected.push(relatedResults[i])
    }
    const seen = new Set()
    pool = [...collected, ...pool].filter(video => {
      if (!valid(video) || seen.has(video.videoId)) return false
      seen.add(video.videoId)
      return true
    }).slice(0, 300)

    const previousIds = new Set(recentIds.flat())
    const next = [...pool.filter(video => !previousIds.has(video.videoId)), ...pool.filter(video => previousIds.has(video.videoId))].slice(0, 36)
    recentIds = [next.map(video => video.videoId), ...recentIds].slice(0, 3)
    return next
  }

  return { refresh, getStatus: () => ({ homeAvailable }) }
}
