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

/** Page through search results for watched titles instead of restarting at page one. */
export function createInterestSearch({ search, next }) {
  const cursors = new Map()
  const generations = new Map()

  return async query => {
    const generation = (generations.get(query) ?? 0) + 1
    generations.set(query, generation)
    let result
    const cursor = cursors.get(query)
    if (cursor) {
      try {
        result = await next(cursor)
      } catch {
        // Expired continuations are common; request a new search below.
      }
    }
    if (!result?.results?.length) result = await search(query)
    if (generations.get(query) === generation) {
      if (result?.continuationData) cursors.set(query, result.continuationData)
      else cursors.delete(query)
      if (cursors.size > 24) cursors.delete(cursors.keys().next().value)
      if (generations.size > 48) generations.delete(generations.keys().next().value)
    }
    return result?.results ?? []
  }
}

/** Browse home recommendations and related searches based only on watched titles. */
export function createDiscoveryBrowser({ open, search, getHistory = () => [], kind = 'discover', timeoutMs = 12000 }) {
  let currentFeed = null
  let pool = []
  let recentIds = []
  let queryOffset = 0
  let homeAvailable = true
  let limited = false

  async function readHome() {
    const startedAt = Date.now()
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
    const videos = [...(feed?.videos ?? [])]
    const previousIds = new Set(recentIds.flat())
    // A continuation may contain another small shelf or only repeated videos.
    // Read ahead a little so Refresh can bring in genuinely new recommendations.
    for (let page = 1; page < 3 && feed?.has_continuation; page++) {
      const newCount = new Set(videos.filter(video => video?.videoId && !previousIds.has(video.videoId)).map(video => video.videoId)).size
      if (newCount >= 18) break
      const remainingMs = timeoutMs - (Date.now() - startedAt) - 50
      if (remainingMs <= 0) break
      try {
        const nextPage = await withTimeout(feed.getContinuation(), Math.min(remainingMs, timeoutMs / 3, 4000))
        if (!nextPage) break
        feed = nextPage
        videos.push(...(feed.videos ?? []))
      } catch {
        break
      }
    }
    return { videos, feed }
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
    const lastIds = new Set(recentIds[0] ?? [])
    const unseen = pool.filter(video => !previousIds.has(video.videoId))
    const older = pool.filter(video => previousIds.has(video.videoId) && !lastIds.has(video.videoId))
    const repeated = pool.filter(video => lastIds.has(video.videoId))
    limited = recentIds.length > 0 && unseen.length === 0

    // If the service really has no new items, still change the ordering rather
    // than appearing stuck. Do not represent rearranged items as new videos.
    if (!unseen.length && !older.length && repeated.length > 1) {
      const byId = new Map(repeated.map(video => [video.videoId, video]))
      const previousOrder = (recentIds[0] ?? []).map(id => byId.get(id)).filter(Boolean)
      const previousSet = new Set(previousOrder.map(video => video.videoId))
      const remaining = repeated.filter(video => !previousSet.has(video.videoId))
      const combined = [...previousOrder, ...remaining]
      const shift = Math.ceil(combined.length / 2)
      repeated.splice(0, repeated.length, ...combined.slice(shift), ...combined.slice(0, shift))
    }
    const next = [...unseen, ...older, ...repeated].slice(0, 36)
    recentIds = [next.map(video => video.videoId), ...recentIds].slice(0, 3)
    return next
  }

  return { refresh, getStatus: () => ({ homeAvailable, limited }) }
}
