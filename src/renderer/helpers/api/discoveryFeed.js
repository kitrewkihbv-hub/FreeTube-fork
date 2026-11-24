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

// Diverse searches supplement YouTube's home recommendations when they repeat or
// contain only a few cards. These are ordinary public YouTube searches, not
// personalised recommendations or subscriptions.
const DISCOVERY_TOPICS = [
  'nature documentary', 'space exploration', 'travel videos', 'creative cooking',
  'technology inventions', 'animals wildlife', 'ocean exploration', 'history documentary',
  'science experiments', 'architecture design', 'photography tutorials', 'art and painting',
  'game highlights', 'puzzles and brain teasers', 'cars and engineering', 'woodworking projects',
  'hiking adventures', 'funny animals', 'creative animation', 'amazing crafts',
  'world geography', 'gardening tips', 'aerial drone views', 'trains and railways',
  'robotics projects', 'behind the scenes filmmaking', 'volcanoes and geology', 'wildlife rescue',
  'food around the world', 'building restoration', 'astronomy discoveries', 'camping adventures',
  'board games', 'classic video games', 'museum tours', 'weather phenomena',
]

function shuffle(items, random) {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// A stalled source should not leave Refresh disabled indefinitely. The timeout
// only stops waiting; the request itself may still finish in the background.
function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Discovery request timed out')), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Stateful discovery browser with home recommendations and rotating topic searches. */
export function createDiscoveryBrowser({ open, search, kind = 'discover', random = Math.random, timeoutMs = 12000 }) {
  let currentFeed = null
  let pool = []
  let recentIds = []
  let topics = []
  let lastTopics = new Set()

  function nextTopics() {
    if (topics.length < 3) {
      topics = shuffle(DISCOVERY_TOPICS.filter(topic => !lastTopics.has(topic)), random)
    }
    const selected = topics.splice(0, 3)
    lastTopics = new Set(selected)
    return selected
  }

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
    if (!feed) return { videos: [], feed: null }
    return { videos: [...(feed.videos ?? [])], feed }
  }

  async function refresh() {
    // Every refresh searches a different set of broad topics in parallel with
    // YouTube's home feed, so even a fixed home shelf can produce new videos.
    const sources = [withTimeout(readHome(), timeoutMs)]
    if (search) {
      for (const topic of nextTopics()) {
        sources.push(withTimeout(Promise.resolve().then(() => search(topic)), timeoutMs))
      }
    }
    const settled = await Promise.allSettled(sources)
    const home = settled[0]
    if (home.status === 'fulfilled') currentFeed = home.value.feed
    const collected = [
      ...(home.status === 'fulfilled' ? home.value.videos : []),
      ...settled.slice(1).flatMap(result => result.status === 'fulfilled' ? result.value ?? [] : []),
    ].filter(video => video?.type === 'video' && video.videoId)
    if (!collected.length) throw new Error('No readable videos were returned.')

    const seen = new Set()
    pool = [...shuffle(collected, random), ...pool].filter(video => {
      if (seen.has(video.videoId)) return false
      seen.add(video.videoId)
      return true
    }).slice(0, 300)

    const previousIds = new Set(recentIds.flat())
    const shuffled = shuffle(pool, random)
    const next = [...shuffled.filter(video => !previousIds.has(video.videoId)), ...shuffled.filter(video => previousIds.has(video.videoId))].slice(0, 36)
    recentIds = [next.map(video => video.videoId), ...recentIds].slice(0, 3)
    return next
  }

  return { refresh }
}
