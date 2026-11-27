// Check the real watch view's timeupdate handler preserves local chapter handling
// and reports only while history is enabled and the player is actually running.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const code = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
const a = code.indexOf('    handleTimeUpdate: function (currentSeconds) {')
const b = code.indexOf('    updateCurrentChapter: function', a)
assert.ok(a >= 0 && b > a)
const handler = vm.runInNewContext(`({${code.slice(a, b)}}).handleTimeUpdate`)
const chapters = [], updates = []
const view = { rememberHistory: true, isUpcoming: false, $refs: { player: { hasLoaded: true, isPaused: () => false } }, updateCurrentChapter: n => chapters.push(n), accountWatchTracker: { update: n => updates.push(n) } }
handler.call(view, 1)
view.rememberHistory = false
handler.call(view, 2)
view.rememberHistory = true
view.$refs.player.isPaused = () => true
handler.call(view, 3)
view.$refs.player.isPaused = () => false
view.isUpcoming = true
handler.call(view, 4)
assert.deepEqual(chapters, [1, 2, 3, 4])
assert.deepEqual(updates, [1])
assert.match(code, /if \(this\.rememberHistory\) \{[\s\S]*?this\.addToHistory\(/, 'existing local history still records videos')
assert.match(code, /this\.updateWatchProgress\(payload\)/, 'existing local progress saves remain in place')
assert.match(code, /selectedPlayer !== 'web' && !this\.videoPlayerLoaded/, 'early preferred-stream 403 retries Web fallback once')
assert.match(code, /getLocalVideoInfo\(this\.videoId, \{ playerFallbackStage \}\)/, 'retry skips failed clients rather than disabling account watch reporting')
const errorStart = code.indexOf('    handlePlayerError: function (error) {')
const errorEnd = code.indexOf('    handleActiveFormatUnavailable:', errorStart)
const onError = vm.runInNewContext(`({${code.slice(errorStart, errorEnd)}}).handlePlayerError`, { shaka: { util: { Error: { Code: { HTTP_ERROR: 1, BAD_HTTP_STATUS: 2, VIDEO_ERROR: 3 } } } } })
const stages = []
const playerView = { selectedPlayer: 'embedded', videoPlayerLoaded: false, isReloadingView: false, streamingDataExpiryDate: new Date(Date.now() + 100000), handleWatchProgressAutoSaveWhenProgressEnabled() {}, reloadView: async stage => stages.push(stage) }
onError.call(playerView, { code: 2, data: [null, 403] })
playerView.selectedPlayer = 'android-vr'
onError.call(playerView, { code: 2, data: [null, 403] })
playerView.selectedPlayer = 'web'
onError.call(playerView, { code: 2, data: [null, 403] })
assert.deepEqual(stages, [1, 2], 'early media errors advance embedded → VR → Web without looping')
assert.match(playerView.errorMessage, /403/)
console.log('Watch history reporting tests passed')
