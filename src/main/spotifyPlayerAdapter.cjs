// A deliberately small local adapter, not Spotify, OAuth, or a Spotify account.
// It exposes only the currently loaded MacTube Music player to local programs.
function createSpotifyPlayerAdapter({ getPlayback, onCommand }) {
  const json = (response, status, message) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: { status, message } }))
  return async function handleSpotifyPlayer(request, response, url) {
    if (!url.pathname.startsWith('/v1/me/player')) return false
    // No CORS: a random website must not gain a second cross-origin controller.
    if (request.headers.origin || request.headers['sec-fetch-site']) {
      json(response, 403, 'Browser origins are not supported by the local adapter')
      return true
    }
    const playback = getPlayback()
    const path = url.pathname
    const reading = request.method === 'GET' && (path === '/v1/me/player' || path === '/v1/me/player/currently-playing')
    if (reading) {
      if (!playback?.title) { response.writeHead(204).end(); return true }
      const id = /^[A-Za-z0-9_-]{11}$/.test(playback.videoId || '') ? playback.videoId : ''
      const duration = Math.max(0, Math.round(playback.durationMs || 0))
      const position = Math.min(duration || Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(playback.progressMs || 0)))
      const images = id ? [{ url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, height: 180, width: 320 }] : []
      const external = id ? { youtube: `https://www.youtube.com/watch?v=${id}` } : {}
      const result = {
        timestamp: Date.now(),
        context: null,
        progress_ms: position,
        is_playing: playback.playing === true,
        currently_playing_type: 'track',
        item: {
          id: id || null, type: 'track', uri: id ? `youtube:video:${id}` : null,
          name: playback.title, duration_ms: duration, explicit: false, external_urls: external,
          artists: [{ name: playback.artist || '', type: 'artist', external_urls: {} }],
          album: { name: 'YouTube', album_type: 'album', images, external_urls: {} }
        },
        actions: { disallows: { toggling_repeat_context: true, toggling_repeat_track: true, toggling_shuffle: true, setting_volume: true, transferring_playback: true } }
      }
      if (path === '/v1/me/player') {
        result.device = { id: 'mactube-local', is_active: true, is_private_session: true, is_restricted: false, name: 'MacTube', type: 'Computer', volume_percent: null, supports_volume: false }
        result.repeat_state = null
        result.shuffle_state = playback.shuffle === true
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result))
      return true
    }

    const routes = {
      '/v1/me/player/play': ['PUT', 'play'],
      '/v1/me/player/pause': ['PUT', 'pause'],
      '/v1/me/player/next': ['POST', 'next'],
      '/v1/me/player/previous': ['POST', 'prev'],
      '/v1/me/player/seek': ['PUT', 'seek']
    }
    const route = routes[path]
    if (!route) { json(response, 404, 'Unsupported local player endpoint'); return true }
    if (request.method !== route[0]) { json(response, 405, 'Method not allowed'); return true }
    const device = url.searchParams.get('device_id')
    if (device && device !== 'mactube-local') { json(response, 404, 'Device not found'); return true }
    if (!playback?.title) { json(response, 404, 'No active MacTube Music player'); return true }

    // No arbitrary Spotify track, context or queue playback: only resume/pause
    // the current player. Limit request bodies and reject unsupported options.
    request.setTimeout(5000, () => request.destroy())
    let body = ''
    for await (const chunk of request) {
      body += chunk.toString('utf8')
      if (body.length > 1024) { json(response, 413, 'Request body too large'); return true }
    }
    if (body.trim()) {
      try {
        const parsed = JSON.parse(body)
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length) throw new Error('unsupported')
      } catch {
        json(response, 400, 'Track and context selection are not supported')
        return true
      }
    }
    let command = route[1]
    if (command === 'seek') {
      const raw = url.searchParams.get('position_ms')
      if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > playback.durationMs || !playback.durationMs) {
        json(response, 400, 'Invalid seek position')
        return true
      }
      command = { type: 'seek', positionMs: Number(raw) }
    }
    onCommand(command)
    response.writeHead(204).end()
    return true
  }
}
module.exports = { createSpotifyPlayerAdapter }
