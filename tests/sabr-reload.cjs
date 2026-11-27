const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const code = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
const start = code.indexOf('    async onSabrReloadRequested() {')
const end = code.indexOf('    ...mapActions([', start)
assert.ok(start >= 0 && end > start)
const handler = vm.runInNewContext(`({${code.slice(start, end)}}).onSabrReloadRequested`, { showToast() {} })

;(async () => {
  const stages = []
  const view = {
    videoId: 'video-one', $route: { params: { id: 'video-one' } }, selectedPlayer: 'authenticated-embedded',
    sabrRetryVideoId: null, sabrReloadCount: 0, sabrWebRetried: false, sabrReloadPending: false, isReloadingView: false,
    saveWatchProgressForReload: async () => {}, reloadView: async stage => stages.push(stage), errorMessage: null,
  }
  await handler.call(view)
  view.selectedPlayer = 'embedded'; await handler.call(view)
  view.selectedPlayer = 'android-vr'; await handler.call(view)
  view.selectedPlayer = 'web'; await handler.call(view)
  await handler.call(view)
  assert.deepEqual(stages, [1, 2, 3, 3])
  assert.match(view.errorMessage, /repeatedly requested a reload/)
  view.videoId = 'video-two'; view.$route.params.id = 'video-two'; view.errorMessage = null
  await handler.call(view); await handler.call(view)
  assert.deepEqual(stages, [1, 2, 3, 3, 3], 'a new video gets one fresh Web retry')
  assert.match(view.errorMessage, /repeatedly/)
  view.videoId = 'video-three'; view.$route.params.id = 'video-three'; view.errorMessage = null
  let resolveSave
  view.saveWatchProgressForReload = () => new Promise(resolve => { resolveSave = resolve })
  const pending = handler.call(view)
  await handler.call(view)
  view.$route.params.id = 'video-four'
  resolveSave()
  await pending
  assert.deepEqual(stages, [1, 2, 3, 3, 3], 'duplicate and stale route events do not reload')
  assert.equal(view.sabrReloadPending, false)
  view.videoId = 'video-four'; view.saveWatchProgressForReload = async () => { throw new Error('unavailable') }
  await handler.call(view)
  assert.match(view.errorMessage, /Could not reload/)
  assert.equal(view.sabrReloadPending, false)
  console.log('Bounded SABR reload tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
