const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const http = require('node:http')
const { createWidgetPlayerRegistry, startWidgetPlayerBridge } = require('../src/main/widgetPlayerBridge.cjs')
const { createMusicControlLifecycle } = require('../src/main/musicControlLifecycle.cjs')
const fs = require('node:fs')
const vm = require('node:vm')

const request = (port, path, options = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers }, res => {
    let body = ''
    res.on('data', data => { body += data })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
  })
  req.on('error', reject); req.end(options.body)
})
class Sender extends EventEmitter {
  constructor(id) { super(); this.id = id; this.dead = false }
  isDestroyed() { return this.dead }
}
;(async () => {
  const states = [], dispatched = []
  const registry = createWidgetPlayerRegistry(active => states.push(active))
  const server = startWidgetPlayerBridge({ registry, dispatch: (sender, command) => dispatched.push({ id: sender.id, command }), port: 0 })
  await once(server, 'listening')
  const port = server.address().port
  const video = new Sender(1), music = new Sender(2)
  const state = mode => ({ mode, videoId: 'abcdefghijk', title: 'Café 🎵', artist: 'Creator', playing: true, duration: 150, position: 12 })
  try {
    assert.equal((await request(port, '/youtube/player')).status, 204)
    assert.equal((await request(port, '/v1/me/player')).status, 204)
    registry.setPlayer(video, state('video'))
    assert.equal(states.at(-1), true)
    let result = await request(port, '/youtube/player')
    assert.equal(result.status, 200)
    const v = JSON.parse(result.body)
    assert.equal(v.playerState, 1); assert.equal(v.videoData.title, 'Café 🎵'); assert.equal(v.videoData.video_id, 'abcdefghijk')
    assert.equal(v.currentTime, 12); assert.equal(v.duration, 150)
    assert.equal(result.headers['access-control-allow-origin'], undefined)
    assert.equal((await request(port, '/v1/me/player')).status, 204, 'ordinary videos are not exposed as Music')
    registry.setPlayer(music, { ...state('music'), playing: false })
    result = await request(port, '/v1/me/player/currently-playing')
    const m = JSON.parse(result.body)
    assert.equal(m.is_playing, false); assert.equal(m.progress_ms, 12000); assert.equal(m.item.duration_ms, 150000)
    assert.equal(m.item.artists[0].name, 'Creator'); assert.equal(m.item.uri, 'youtube:video:abcdefghijk')
    assert.equal((await request(port, '/youtube/player/pauseVideo', { method: 'POST' })).status, 204)
    assert.equal((await request(port, '/youtube/player/seekTo?seconds=35.5', { method: 'POST' })).status, 204)
    assert.equal((await request(port, '/v1/me/player/play', { method: 'PUT' })).status, 204)
    assert.equal((await request(port, '/v1/me/player/next', { method: 'POST' })).status, 204)
    assert.equal((await request(port, '/v1/me/player/seek?position_ms=1550', { method: 'PUT' })).status, 204)
    assert.deepEqual(dispatched.map(x => [x.id, x.command.action, x.command.seconds]), [
      [1, 'pause', undefined], [1, 'seek', 35.5], [2, 'play', undefined], [2, 'next', undefined], [2, 'seek', 1.55]
    ])
    assert.equal((await request(port, '/youtube/player', { headers: { origin: 'https://example.org' } })).status, 403)
    assert.equal((await request(port, '/youtube/player/playVideo', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })).status, 403)
    assert.equal((await request(port, '/youtube/player', { headers: { host: `evil.example:${port}` } })).status, 403)
    assert.equal((await request(port, '/v1/me/player', { headers: { authorization: 'Bearer fake' } })).status, 400)
    assert.equal((await request(port, '/v1/me/player/play', { method: 'PUT', body: '{}' })).status, 400)
    assert.equal((await request(port, '/v1/me/player/seek?position_ms=-1', { method: 'PUT' })).status, 400)
    assert.equal((await request(port, '/youtube/player/seekTo?seconds=151', { method: 'POST' })).status, 400)
    assert.equal((await request(port, '/youtube/player/nextVideo', { method: 'GET' })).status, 405)
    assert.equal((await request(port, '/v1/me/player/play?device_id=other', { method: 'PUT' })).status, 404)
    assert.equal(dispatched.length, 5, 'invalid requests never control the player')
    registry.setPlayer(video, null)
    assert.equal((await request(port, '/youtube/player')).status, 204)
    music.emit('render-process-gone')
    assert.equal(states.at(-1), false)
    assert.equal((await request(port, '/v1/me/player')).status, 204)
  } finally { await new Promise(resolve => server.close(resolve)) }

  // The listener is actually opened for an opted-in loaded player and closed
  // after the last player's state is cleared, not merely marked inactive.
  let liveServer
  const lifecycle = createMusicControlLifecycle(() => {
    liveServer = startWidgetPlayerBridge({ registry: lifeRegistry, dispatch() {}, port: 0 })
    return liveServer
  })
  const lifeRegistry = createWidgetPlayerRegistry(active => lifecycle.setActive(active))
  const one = new Sender(3)
  lifeRegistry.setPlayer(one, state('video'))
  await once(liveServer, 'listening')
  assert.equal((await request(liveServer.address().port, '/youtube/player')).status, 200)
  const closed = once(liveServer, 'close')
  lifeRegistry.setPlayer(one, null)
  await closed
  assert.equal(lifecycle.getPhase(), 'stopped')

  // Exercise the actual Watch methods with the bridge off and on.
  const code = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
  const a = code.indexOf('    syncWidgetBridgeState() {'), b = code.indexOf('    handleLocalPlayerCommand(command)', a)
  assert.ok(a >= 0 && b > a)
  const published = [], calls = []
  const methods = vm.runInNewContext(`({${code.slice(a, b)}})`, { process: { env: { IS_ELECTRON: true } }, window: { ftElectron: { updateWidgetBridgeState: s => published.push(s) } }, Number })
  let paused = false, time = 6
  const view = { ...methods, widgetControlsActive: true, widgetBridgeEnabled: false, widgetBridgePublished: false, videoId: 'abcdefghijk', videoTitle: 'Title', channelName: 'Name', videoLengthSeconds: 100, musicCurrentTime: 6, musicPlaying: true, videoPlayerLoaded: true, isLoading: false, isReloadingView: false, errorMessage: null, watchingPlaylist: false, $route: { params: { id: 'abcdefghijk' }, query: {} }, $refs: { player: { isPaused: () => paused, togglePlayback: () => calls.push('toggle'), pause: () => calls.push('pause'), getCurrentTime: () => time, setCurrentTime: x => calls.push(`seek:${x}`) } }, $router: { back: () => calls.push('back') }, handleSkipToNext: () => calls.push('next'), handleSkipToPrev: () => calls.push('prev') }
  view.syncWidgetBridgeState(); assert.equal(published.length, 0, 'disabled by default: no player updates')
  view.widgetBridgeEnabled = true; view.syncWidgetBridgeState(); assert.equal(published.at(-1).mode, 'video')
  const cmd = action => ({ action, mode: 'video', videoId: 'abcdefghijk' })
  view.handleWidgetBridgeCommand(cmd('pause')); view.handleWidgetBridgeCommand(cmd('play'))
  paused = true; view.handleWidgetBridgeCommand(cmd('play'))
  view.handleWidgetBridgeCommand(cmd('next')); view.handleWidgetBridgeCommand(cmd('previous'))
  time = 1; view.handleWidgetBridgeCommand(cmd('previous'))
  view.watchingPlaylist = true; view.handleWidgetBridgeCommand(cmd('previous'))
  view.handleWidgetBridgeCommand({ ...cmd('seek'), seconds: 30 })
  view.handleWidgetBridgeCommand({ ...cmd('seek'), seconds: 101 })
  view.handleWidgetBridgeCommand({ ...cmd('play'), videoId: 'different' })
  assert.deepEqual(calls, ['pause', 'toggle', 'next', 'seek:0', 'back', 'prev', 'seek:30'])
  view.$route.query.music = '1'; view.syncWidgetBridgeState(); assert.equal(published.at(-1).mode, 'music')
  view.handleWidgetBridgeCommand(cmd('next')); assert.equal(calls.length, 7, 'stale video command is ignored')
  view.widgetBridgeEnabled = false; view.syncWidgetBridgeState(); assert.equal(published.at(-1), null)
  const length = published.length; view.syncWidgetBridgeState(); assert.equal(published.length, length)
  assert.match(fs.readFileSync('src/renderer/store/modules/settings.js', 'utf8'), /enableLocalWidgetBridge: false/)
  console.log('Opt-in player bridge tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
