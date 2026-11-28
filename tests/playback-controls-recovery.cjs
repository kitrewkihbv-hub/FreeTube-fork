const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { hasDirectDashUrl, canTryDirectDash, fallbackStageFor } = require('../src/renderer/helpers/player/sabrRecovery.cjs')
const source = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
const player = fs.readFileSync('src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', 'utf8')
const watch = fs.readFileSync('src/renderer/views/Watch/Watch.vue', 'utf8')
const settings = fs.readFileSync('src/renderer/store/modules/settings.js', 'utf8')
const audio = { has_audio: true, signature_cipher: 'cipher' }, video = { has_video: true, url: 'url' }
assert.equal(canTryDirectDash([audio, video]), true)
assert.equal(canTryDirectDash([audio, { has_video: true }]), false)
assert.equal(canTryDirectDash([video]), false)
assert.equal(hasDirectDashUrl({ url: 'url', is_type_otf: true }), false)
assert.equal(hasDirectDashUrl({ url: {} }), false)
assert.equal(canTryDirectDash([audio, { ...video, is_type_otf: true }]), false)
assert.equal(canTryDirectDash(null), false)
assert.equal(fallbackStageFor('authenticated-embedded', false), 0)
assert.equal(fallbackStageFor('authenticated-embedded', true), 1)
assert.equal(fallbackStageFor('embedded', true), 2)
assert.equal(fallbackStageFor('android-vr', true), 3)
assert.equal(fallbackStageFor('web', true), 3)
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a)
  assert.ok(a >= 0 && b > a, `missing section ${start}`)
  return source.slice(a, b)
}
const toasts = [], calls = []
const recovery = vm.runInNewContext(`({${section('    async onSabrReloadRequested() {', '    ...mapActions([')}})`, {
  showToast: value => toasts.push(value), fallbackStageFor, Number, console: { warn() {} },
}).onSabrReloadRequested
const paused = { value: true }
const view = { videoId: 'abcdefghijk', $route: { params: { id: 'abcdefghijk' } },
  $refs: { player: { hasLoaded: true, isPaused: () => paused.value } }, selectedPlayer: 'authenticated-embedded',
  isReloadingView: false, sabrRecoveryInFlight: false, sabrRecoveryVideoId: null,
  sabrRecoveryCount: 0, sabrDeferredVideoId: null, getTimestamp: () => 59,
  reloadView: async (stage, options) => calls.push([stage, options.timestamp, options.preferDirectDash]) }
;(async () => {
  await recovery.call(view)
  assert.equal(view.sabrDeferredVideoId, view.videoId); assert.equal(calls.length, 0, 'paused player is not restarted')
  paused.value = false
  await recovery.call(view)
  assert.equal(view.sabrResumeVideoId, view.videoId)
  assert.deepEqual(calls[0], [0, 59, true], 'try same client direct DASH with preserved position')
  view.selectedPlayer = 'embedded'; await recovery.call(view)
  view.selectedPlayer = 'android-vr'; await recovery.call(view)
  assert.deepEqual(calls.slice(1), [[2, 59, true], [3, 59, true]])
  await recovery.call(view); assert.equal(calls.length, 3, 'recovery attempts are bounded')
  assert.match(toasts.at(-1), /could not recover/)
  view.$route.params.id = 'different00'; await recovery.call(view); assert.equal(calls.length, 3, 'stale route ignored')
  view.videoId = 'different00'; await recovery.call(view); assert.equal(calls.length, 4, 'new video gets a new budget')
  let resolve
  view.reloadView = () => new Promise(done => { resolve = done })
  const pending = recovery.call(view); await recovery.call(view)
  assert.equal(view.sabrRecoveryCount, 2, 'in-flight request is not duplicated')
  resolve(); await pending
  view.reloadView = async () => { throw Error('offline') }
  await recovery.call(view); assert.equal(view.sabrRecoveryInFlight, false); assert.equal(view.sabrResumeVideoId, null)
  assert.match(toasts.at(-1), /Could not reload/)

  const watcher = vm.runInNewContext(`({${section('    musicPlaying(playing) {', '    musicShuffle()')}})`).musicPlaying
  let resumed = 0
  const watched = { videoId: 'id', sabrDeferredVideoId: 'id', sabrResumeVideoId: 'id', syncLocalPlayerState() {}, onSabrReloadRequested() { resumed++ } }
  watcher.call(watched, false); assert.equal(resumed, 0)
  watcher.call(watched, true); assert.equal(resumed, 1); assert.equal(watched.sabrResumeVideoId, null)

  const reload = vm.runInNewContext(`({${section('    async reloadView(', '    resetVideoState:')}})`).reloadView
  const stages = []
  const host = { isReloadingView: false, $route: { params: { id: 'abcdefghijk' } }, $refs: {}, defaultVideoFormat: 'dash', backendPreference: 'local',
    handleRouteChange: async () => {}, resetVideoState() {}, checkIfTimestamp() { this.oneTimeTimestamp = null },
    checkIfPlaylist() {}, setViewingModeOnRouteChange() {}, async getVideoInformationLocal(stage, direct) { stages.push([stage, direct, this.oneTimeTimestamp]) } }
  await reload.call(host, 1, { timestamp: 59, preferDirectDash: true })
  assert.deepEqual(stages, [[1, true, 59]]); assert.equal(host.isReloadingView, false)
  const directMethod = vm.runInNewContext(`({${section('    createLocalDashManifest: async function', '    createLocalSabrManifest:')}})`, { hasDirectDashUrl, encodeURIComponent }).createLocalDashManifest
  let manifestOptions
  const manifest = await directMethod.call({}, { toDash: async opts => { manifestOptions = opts; return '<MPD/>' } }, false, true)
  assert.ok(manifest.startsWith('data:application/dash+xml'))
  assert.equal(manifestOptions.format_filter(audio), false, 'keep direct audio')
  assert.equal(manifestOptions.format_filter({ has_video: true }), true, 'exclude URL-less formats')
  assert.match(source, /format_filter: directOnly \? format => !hasDirectDashUrl\(format\) : undefined/)
  assert.match(source, /preferDirectDash && canTryDirectDash\(result\.streaming_data\.adaptive_formats\)/)
  assert.match(source, /currentSeconds >= this\.sabrRecoveryPosition \+ 60/)
  assert.match(watch, /:autoplay-override="sabrResumeVideoId === videoId"/)
  assert.match(player, /autoplayVideos \|\| autoplayOverride/)

  const skip = vm.runInNewContext(`({${section('    handleSkipToNext: function ()', '    // Skip to the previous video')}})`, { showToast() {} }).handleSkipToNext
  const navigation = []
  const skipping = { playNextTimeout: 10, abortAutoplayCountdown: () => navigation.push('cancel'), watchingPlaylist: false,
    hideRecommendedVideos: false, nextRecommendedVideo: { videoId: 'nextVideo01' },
    $route: { query: {} }, $router: { push: value => navigation.push(value.path) }, t: value => value }
  skip.call(skipping); assert.deepEqual(navigation, ['cancel', '/watch/nextVideo01'], 'skip is immediate and cancels countdown even if autoplay is off')
  skipping.playNextTimeout = null; skipping.watchingPlaylist = true
  skipping.$refs = { watchVideoPlaylist: { playNextVideo: () => navigation.push('playlist-next') } }
  skip.call(skipping); assert.equal(navigation.at(-1), 'playlist-next')
  skipping.watchingPlaylist = false; skipping.hideRecommendedVideos = true
  skip.call(skipping); assert.equal(navigation.length, 3, 'no hidden recommendation navigation')

  const toggle = vm.runInNewContext(`({${section('    toggleAutoplay: function()', '    updateLocalPlaylistLastPlayedAtSometimes()')}})`).toggleAutoplay
  const dispatched = []
  const toggleView = { watchingPlaylist: false, autoplayEnabled: false, playNextTimeout: null, $store: { dispatch: (...args) => dispatched.push(args) } }
  toggle.call(toggleView); assert.equal(toggleView.autoplayNextRecommendedVideo, true)
  toggleView.watchingPlaylist = true; toggleView.autoplayEnabled = true; toggleView.playNextTimeout = 123
  toggleView.abortAutoplayCountdown = () => dispatched.push(['cancel'])
  toggle.call(toggleView); assert.equal(toggleView.autoplayNextPlaylistVideo, false)
  assert.deepEqual(dispatched, [['updatePlayNextVideo', true], ['cancel'], ['updateAutoplayPlaylists', false]])
  assert.match(watch, /:next-video-available="watchingPlaylist \|\| \(!hideRecommendedVideos && !!nextRecommendedVideo\)"/)
  assert.match(player, /if \(!props\.nextVideoAvailable\) \{\s*removeFromArrayIfExists\(uiConfig\.controlPanelElements, 'ft_skip_next'\)/)
  assert.match(settings, /defaultInterval: 0/)
  assert.match(fs.readFileSync('src/main/poTokenGenerator.js', 'utf8'), /setProxy\(proxyUrl \? \{ proxyRules: proxyUrl \} : \{ mode: 'system' \}\)/)
  console.log('Playback recovery, next controls and proxy tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
