const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const db = new Map()
const handlers = {
  find: async () => Array.from(db.values()).map(record => ({ ...record })),
  upsert: async record => db.set(record.videoId, { ...record }),
  updateWatchProgress: async (id, progress) => db.set(id, { ...db.get(id), watchProgress: progress }),
}
const source = fs.readFileSync('src/renderer/store/modules/history.js', 'utf8')
  .replace(/^import .*\n/, '')
  .replace('export default {', 'globalThis.history = {')
const context = vm.createContext({ DBHistoryHandlers: handlers, console })
vm.runInContext(source, context)
const store = context.history
const commit = (name, payload) => store.mutations[name](store.state, payload)
;(async () => {
  await store.actions.updateHistory({ commit }, { videoId: 'local', title: 'Local', watchProgress: 22, timeWatched: 10 })
  await store.actions.updateWatchProgress({ commit }, { videoId: 'local', watchProgress: 40 })
  assert.equal(db.get('local').watchProgress, 40)
  await store.actions.mergeYouTubeAccountHistory({ commit }, [
    { videoId: 'local', title: 'Imported title', watchProgress: 0, timeWatched: 20 },
    { videoId: 'youtube', title: 'Imported', timeWatched: 15 },
  ])
  assert.equal(db.get('local').watchProgress, 40, 'account imports preserve existing local progress')
  assert.equal(db.get('local').title, 'Local')
  assert.equal(db.get('youtube').title, 'Imported')
  console.log('Local history persistence tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
