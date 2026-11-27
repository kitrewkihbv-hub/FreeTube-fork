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
assert.match(code, /usedPreferredPlayer && !this\.videoPlayerLoaded/, 'early preferred-stream 403 retries Web fallback once')
assert.match(code, /skipPreferredPlayer: preferWebFallback/, 'retry skips the preferred stream rather than disabling account watch reporting')
console.log('Watch history reporting tests passed')
