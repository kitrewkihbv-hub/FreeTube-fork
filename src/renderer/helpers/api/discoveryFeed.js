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

/** Stateful discovery browser: refresh advances YouTube's continuation where available. */
export function createDiscoveryBrowser({ open, kind, random = Math.random }) {
  let currentFeed = null
  let pool = []
  let previousIds = new Set()

  async function refresh() {
    let feed
    if (kind === 'discover' && currentFeed?.has_continuation) {
      try {
        feed = await currentFeed.getContinuation()
      } catch {
        // A continuation may expire; start a fresh browse instead of getting stuck.
        feed = await open(kind)
      }
    } else {
      feed = await open(kind)
    }

    const collected = []
    // Read a few shelves/pages, rather than permanently displaying just the first row.
    for (let i = 0; feed && i < 3; i++) {
      collected.push(...(feed.videos ?? []))
      if (!feed.has_continuation || i === 2) break
      try {
        feed = await feed.getContinuation()
      } catch (error) {
        if (!collected.length) throw error
        break
      }
    }

    const eligible = collected.filter(video => video?.type === 'video' && video.videoId && (kind !== 'live' || video.liveNow === true))
    if (!eligible.length) throw new Error('No readable videos were returned.')

    const seen = new Set()
    pool = (kind === 'live' ? eligible : [...eligible, ...pool]).filter(video => {
      if (seen.has(video.videoId)) return false
      seen.add(video.videoId)
      return true
    }).slice(0, 300)
    currentFeed = feed

    const shuffled = pool.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    // Prefer videos not shown on the last refresh; if YouTube returns no new videos,
    // the same available items can still appear in a different order.
    const next = [...shuffled.filter(v => !previousIds.has(v.videoId)), ...shuffled.filter(v => previousIds.has(v.videoId))].slice(0, 36)
    previousIds = new Set(next.map(video => video.videoId))
    return next
  }

  return { refresh }
}
