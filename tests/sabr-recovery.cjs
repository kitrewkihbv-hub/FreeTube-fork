const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
const begin = source.indexOf('    async onSabrReloadRequested() {')
const end = source.indexOf('    ...mapActions([', begin)
assert.ok(begin >= 0 && end > begin)
const toasts = [], calls = []
const methods = vm.runInNewContext(`({${source.slice(begin, end)}})`, { showToast: message => toasts.push(message), console: { warn() {} } })
const paused = { value: true }
const view = {
  ...methods, videoId: 'abcdefghijk', $route: { params: { id: 'abcdefghijk' } },
  $refs: { player: { hasLoaded: true, isPaused: () => paused.value } },
  selectedPlayer: 'authenticated-embedded', isReloadingView: false, sabrReloadInFlight: false,
  sabrPendingVideoId: null, sabrRetryVideoId: null, sabrRetryCount: 0, getTimestamp: () => 42,
  reloadView: async (...args) => { calls.push(args) }
}
;(async () => {
  await view.onSabrReloadRequested()
  assert.equal(view.sabrPendingVideoId, view.videoId, 'paused playback defers recovery')
  assert.equal(calls.length, 0, 'paused playback is not restarted')
  paused.value = false
  await view.onSabrReloadRequested()
  assert.equal(view.sabrPendingVideoId, null)
  assert.equal(view.sabrResumeVideoId, view.videoId, 'playback resumes when user explicitly pressed play')
  assert.deepEqual(calls[0], [1, 42], 'recovery keeps timestamp and advances client')
  view.selectedPlayer = 'embedded'; await view.onSabrReloadRequested()
  view.selectedPlayer = 'android-vr'; await view.onSabrReloadRequested()
  assert.deepEqual(calls.slice(1), [[2, 42], [3, 42]])
  await view.onSabrReloadRequested()
  assert.equal(calls.length, 3, 'repeated failures are bounded')
  assert.match(toasts.at(-1), /Automatic retries stopped/)
  view.$route.params.id = 'different00'; await view.onSabrReloadRequested()
  assert.equal(calls.length, 3, 'stale old-player event is ignored')
  view.$route.params.id = 'different00'; view.videoId = 'different00'
  await view.onSabrReloadRequested(); assert.equal(calls.length, 4, 'new video gets a fresh retry budget')
  let resolve
  view.reloadView = () => new Promise(done => { resolve = done })
  const pending = view.onSabrReloadRequested(); await view.onSabrReloadRequested()
  assert.equal(view.sabrRetryCount, 2, 'simultaneous requests do not trigger duplicate reloads')
  resolve(); await pending
  view.reloadView = async () => { throw Error('offline') }
  await view.onSabrReloadRequested(); assert.equal(view.sabrReloadInFlight, false)
  assert.match(toasts.at(-1), /Could not reload/)
  // Exercise the actual reactive playback watcher: a pause never starts a retry,
  // while pressing play releases one deferred recovery and clears the override.
  const watchBegin = source.indexOf('    musicPlaying(playing) {')
  const watchEnd = source.indexOf('    videoLengthSeconds()', watchBegin)
  const watcher = vm.runInNewContext(`({${source.slice(watchBegin, watchEnd)}})`).musicPlaying
  let resumed = 0
  const observed = { videoId: 'abcdefghijk', sabrResumeVideoId: 'abcdefghijk', sabrPendingVideoId: 'abcdefghijk', syncLocalPlayerState() {}, syncWidgetBridgeState() {}, onSabrReloadRequested() { resumed++ } }
  watcher.call(observed, false); assert.equal(resumed, 0)
  watcher.call(observed, true); assert.equal(resumed, 1); assert.equal(observed.sabrResumeVideoId, null)

  // Real reloadView plumbing keeps progress without changing the route and
  // forwards the chosen fallback to the existing local video-info method.
  const reloadBegin = source.indexOf('    async reloadView(')
  const reloadEnd = source.indexOf('    resetVideoState:', reloadBegin)
  const reload = vm.runInNewContext(`({${source.slice(reloadBegin, reloadEnd)}})`).reloadView
  const usedStages = [], sequence = []
  const host = { isReloadingView: false, $route: { params: { id: 'abcdefghijk' } }, $refs: {}, defaultVideoFormat: 'dash', backendPreference: 'local',
    handleRouteChange: async () => sequence.push('cleanup'), resetVideoState: () => sequence.push('reset'),
    checkIfTimestamp() { this.oneTimeTimestamp = null }, checkIfPlaylist() {}, setViewingModeOnRouteChange() {},
    async getVideoInformationLocal(stage) { usedStages.push(stage); assert.equal(this.oneTimeTimestamp, 42) } }
  await reload.call(host, 2, 42)
  assert.deepEqual(usedStages, [2]); assert.equal(host.isReloadingView, false)
  assert.equal(host.videoId, 'abcdefghijk'); assert.deepEqual(sequence, ['cleanup', 'reset'])
  assert.match(source, /if \(this\.sabrPendingVideoId === this\.videoId\) this\.onSabrReloadRequested\(\)/)
  assert.match(fs.readFileSync('src/renderer/views/Watch/Watch.vue', 'utf8'), /:autoplay-override="sabrResumeVideoId === videoId"/)
  assert.match(fs.readFileSync('src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', 'utf8'), /autoplayVideos \|\| autoplayOverride/)
  assert.match(source, /if \(reloadTimestamp !== null\) this\.oneTimeTimestamp = reloadTimestamp/)
  assert.match(source, /currentSeconds >= this\.sabrRetryStartPosition \+ 30/)
  console.log('SABR pause and bounded recovery tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
