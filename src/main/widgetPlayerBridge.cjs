const http = require('node:http')

// These are local compatibility adapters, not Spotify, YouTube, or OAuth.
// A renderer registers only a loaded player after the user opts in.
function createWidgetPlayerRegistry(setActive) {
  const entries = new Map()
  const tracked = new WeakSet()
  let sequence = 0
  function remove(sender) {
    entries.delete(sender.id)
    setActive(entries.size > 0)
  }
  function setPlayer(sender, value) {
    if (!tracked.has(sender)) {
      tracked.add(sender)
      sender.once('destroyed', () => remove(sender))
      sender.on('render-process-gone', () => remove(sender))
      sender.on('did-start-navigation', (_, __, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) remove(sender)
      })
    }
    if (!value || !['music', 'video'].includes(value.mode) || !/^[\w-]{11}$/.test(value.videoId || '') || typeof value.title !== 'string' || !value.title) {
      remove(sender)
      return
    }
    const clamp = n => Number.isFinite(n) ? Math.min(604800, Math.max(0, n)) : 0
    entries.set(sender.id, { sender, sequence: ++sequence, state: {
      mode: value.mode,
      videoId: value.videoId,
      title: value.title.slice(0, 500),
      artist: typeof value.artist === 'string' ? value.artist.slice(0, 500) : '',
      playing: value.playing === true,
      duration: clamp(value.duration),
      position: clamp(value.position),
    } })
    setActive(true)
  }
  function selected(mode) {
    return [...entries.values()].filter(x => x.state.mode === mode && !x.sender.isDestroyed())
      .sort((a, b) => Number(b.state.playing) - Number(a.state.playing) || b.sequence - a.sequence)[0]
  }
  return { setPlayer, selected }
}

function startWidgetPlayerBridge({ registry, dispatch, port = 8766, logError = console.warn }) {
  const json = (res, status, value) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value))
  const fail = (res, status, message) => json(res, status, { error: message })
  const controls = {
    '/v1/me/player/play': ['music', 'PUT', 'play'],
    '/v1/me/player/pause': ['music', 'PUT', 'pause'],
    '/v1/me/player/next': ['music', 'POST', 'next'],
    '/v1/me/player/previous': ['music', 'POST', 'previous'],
    '/v1/me/player/seek': ['music', 'PUT', 'seek'],
    '/youtube/player/playVideo': ['video', 'POST', 'play'],
    '/youtube/player/pauseVideo': ['video', 'POST', 'pause'],
    '/youtube/player/nextVideo': ['video', 'POST', 'next'],
    '/youtube/player/previousVideo': ['video', 'POST', 'previous'],
    '/youtube/player/seekTo': ['video', 'POST', 'seek'],
  }
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const host = (req.headers.host || '').toLowerCase()
    const port = server.address()?.port
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host) || req.headers.origin || req.headers['sec-fetch-site']) {
      fail(res, 403, 'Browser origins and non-loopback hosts are not allowed')
      return
    }
    // This local API does not authenticate, and must never be sent real tokens.
    if (req.headers.authorization) { fail(res, 400, 'Authorization is not supported'); return }
    let url
    try { url = new URL(req.url, 'http://localhost') } catch { fail(res, 400, 'Invalid URL'); return }
    if (url.origin !== 'http://localhost') { fail(res, 400, 'Invalid URL'); return }
    const p = url.pathname
    const mode = p === '/youtube/player' ? 'video' : ['/v1/me/player', '/v1/me/player/currently-playing'].includes(p) ? 'music' : null
    if (mode) {
      if (req.method !== 'GET') { fail(res, 405, 'Method not allowed'); return }
      const entry = registry.selected(mode)
      if (!entry) { res.writeHead(204).end(); return }
      const s = entry.state
      const duration = s.duration
      const position = Math.min(s.position, duration || s.position)
      const thumbnail = `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`
      if (mode === 'video') {
        json(res, 200, { playerState: s.playing ? 1 : 2, videoData: { video_id: s.videoId, title: s.title, author: s.artist }, currentTime: position, duration, thumbnailUrl: thumbnail })
      } else {
        const state = {
          timestamp: Date.now(), progress_ms: Math.round(position * 1000), is_playing: s.playing, currently_playing_type: 'track',
          item: { id: s.videoId, uri: `youtube:video:${s.videoId}`, type: 'track', name: s.title, duration_ms: Math.round(duration * 1000),
            artists: [{ name: s.artist }], album: { name: 'YouTube', images: [{ url: thumbnail }] },
            external_urls: { youtube: `https://www.youtube.com/watch?v=${s.videoId}` } },
          context: null,
        }
        if (p === '/v1/me/player') state.device = { id: 'mactube-local', name: 'MacTube', type: 'Computer', is_active: true, is_restricted: false, volume_percent: null }
        json(res, 200, state)
      }
      return
    }
    const control = controls[p]
    if (!control) { fail(res, 404, 'Unsupported endpoint'); return }
    if (req.method !== control[1]) { fail(res, 405, 'Method not allowed'); return }
    // No playlist selection or arbitrary Spotify URI playback is supported.
    if (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) { req.resume(); fail(res, 400, 'Request bodies are not supported'); return }
    const device = url.searchParams.get('device_id')
    if (device && device !== 'mactube-local') { fail(res, 404, 'Unknown device'); return }
    const entry = registry.selected(control[0])
    if (!entry) { fail(res, 404, 'No active player'); return }
    const command = { action: control[2], mode: control[0], videoId: entry.state.videoId }
    if (command.action === 'seek') {
      const raw = url.searchParams.get(control[0] === 'music' ? 'position_ms' : 'seconds')
      if (raw === null || !/^\d+(?:\.\d+)?$/.test(raw)) { fail(res, 400, 'Invalid seek position'); return }
      const seconds = Number(raw) / (control[0] === 'music' ? 1000 : 1)
      if (!Number.isFinite(seconds) || !entry.state.duration || seconds > entry.state.duration) { fail(res, 400, 'Invalid seek position'); return }
      command.seconds = seconds
    }
    if (registry.selected(control[0]) !== entry || entry.sender.isDestroyed()) { fail(res, 409, 'Player changed'); return }
    try {
      dispatch(entry.sender, command)
      res.writeHead(204).end()
    } catch {
      fail(res, 503, 'Player unavailable')
    }
  })
  server.on('error', error => logError(`MacTube widget bridge could not start: ${error.message}`))
  server.listen(port, '127.0.0.1')
  return server
}

module.exports = { createWidgetPlayerRegistry, startWidgetPlayerBridge }
