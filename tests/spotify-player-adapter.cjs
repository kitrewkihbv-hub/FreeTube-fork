const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { startLocalControlServer } = require('../src/main/localControlServer.cjs')

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

;(async () => {
  let player = null
  let legacyEnabled = false
  let rejectDispatch = false
  const commands = [], legacyCommands = []
  const server = startLocalControlServer({ port: 0, getStatus: () => ({ title: '', artist: '', playing: false, shuffle: false }), getPlayback: () => player, isLegacyEnabled: () => legacyEnabled, onCommand: command => legacyCommands.push(command), onSpotifyCommand: command => { if (rejectDispatch) return false; commands.push(command) } })
  await once(server, 'listening')
  const port = server.address().port
  try {
    assert.equal((await request(port, '/status')).status, 404, 'legacy API remains inaccessible for an ordinary Watch player')
    assert.equal((await request(port, '/next')).status, 404)
    assert.deepEqual(legacyCommands, [])
    assert.equal((await request(port, '/v1/me/player')).status, 204)
    assert.equal((await request(port, '/v1/me/player/pause', { method: 'PUT' })).status, 404)
    player = { videoId: 'abcdefghijk', title: 'Song', artist: 'Artist', durationMs: 240000, progressMs: 12345, playing: true, shuffle: false }
    let result = await request(port, '/v1/me/player')
    assert.equal(result.status, 200)
    assert.equal(result.headers['access-control-allow-origin'], undefined)
    const state = JSON.parse(result.body)
    assert.equal(state.is_playing, true)
    assert.equal(state.progress_ms, 12345)
    assert.equal(state.device.id, 'mactube-local')
    assert.equal(state.item.name, 'Song')
    assert.equal(state.item.duration_ms, 240000)
    assert.equal(state.item.artists[0].name, 'Artist')
    assert.equal(state.item.uri, 'youtube:video:abcdefghijk')
    assert.equal(state.item.album.images[0].url, 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg')
    result = await request(port, '/v1/me/player/currently-playing')
    assert.equal(JSON.parse(result.body).item.id, 'abcdefghijk')
    assert.equal(JSON.parse(result.body).device, undefined)
    for (const [route, method] of [['play', 'PUT'], ['pause', 'PUT'], ['next', 'POST'], ['previous', 'POST']]) {
      assert.equal((await request(port, `/v1/me/player/${route}`, { method })).status, 204)
    }
    assert.equal((await request(port, '/v1/me/player/seek?position_ms=1200', { method: 'PUT' })).status, 204)
    assert.deepEqual(commands, ['play', 'pause', 'next', 'prev', { type: 'seek', positionMs: 1200 }])
    assert.equal((await request(port, '/v1/me/player/play', { method: 'PUT', body: '{}' })).status, 204)
    assert.equal((await request(port, '/v1/me/player/play', { method: 'PUT', body: '{"uris":["spotify:track:1"]}' })).status, 400)
    assert.equal((await request(port, '/v1/me/player/play', { method: 'PUT', body: 'x'.repeat(1025) })).status, 413)
    for (const query of ['', '?position_ms=-1', '?position_ms=1.5', '?position_ms=999999', '?position_ms=Infinity']) {
      assert.equal((await request(port, `/v1/me/player/seek${query}`, { method: 'PUT' })).status, 400)
    }
    rejectDispatch = true
    assert.equal((await request(port, '/v1/me/player/next', { method: 'POST' })).status, 409)
    rejectDispatch = false
    assert.equal((await request(port, '/v1/me/player/next', { method: 'PUT' })).status, 405)
    assert.equal((await request(port, '/v1/me/player/next?device_id=elsewhere', { method: 'POST' })).status, 404)
    assert.equal((await request(port, '/v1/me/player/volume', { method: 'PUT' })).status, 404)
    assert.equal((await request(port, '/v1/me/player', { headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await request(port, '/v1/me/player/pause', { method: 'PUT', headers: { origin: 'null' } })).status, 403)
    assert.equal((await request(port, '/v1/me/player', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 403)
    assert.equal((await request(port, '/v1/me/player', { headers: { host: `evil.example:${port}` } })).status, 403)
    assert.equal(commands.length, 6, 'rejected requests do not control playback')
    legacyEnabled = true
    assert.equal((await request(port, '/next')).status, 200)
    assert.deepEqual(legacyCommands, ['next'])
    player = { ...player, videoId: 'not a valid id' }
    assert.deepEqual(JSON.parse((await request(port, '/v1/me/player')).body).item.album.images, [])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
  console.log('Spotify-style local player adapter tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
