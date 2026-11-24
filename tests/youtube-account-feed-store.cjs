// A failed/slow old request must not repopulate the feed after sign-out.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/store/modules/youtube-account.js', 'utf8')
  .replace(/^import \{[\s\S]*?\} from '[^']+'\n/, '')
  .replace('export default {', 'globalThis.moduleUnderTest = {')
let resolveFetch
let calls = 0
const context = vm.createContext({ getYouTubeAccountActivityFeed: () => { calls++; return new Promise(resolve => { resolveFetch = resolve }) } })
vm.runInContext(source, context)
const store = context.moduleUnderTest
const commit = (name, value) => store.mutations[name](store.state, value)
const actionContext = { state: store.state, commit }
;(async () => {
  const first = store.actions.grabYouTubeAccountFeed(actionContext, {})
  const concurrent = store.actions.grabYouTubeAccountFeed(actionContext, { refresh: true })
  assert.equal(calls, 1)
  commit('clearYouTubeAccount')
  resolveFetch({ videos: [{ videoId: 'old' }], source: 'youtube', partial: false })
  await Promise.all([first, concurrent])
  assert.equal(store.state.youtubeAccountFeed, null)
  const fresh = store.actions.grabYouTubeAccountFeed(actionContext, {})
  assert.equal(calls, 2)
  resolveFetch({ videos: [{ videoId: 'new' }], source: 'channelUploads', partial: true })
  await fresh
  assert.equal(store.state.youtubeAccountFeed[0].videoId, 'new')
  assert.equal(store.state.youtubeAccountFeedInfo.source, 'channelUploads')
  console.log('YouTube account feed store race tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
