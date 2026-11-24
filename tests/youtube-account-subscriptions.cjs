// Exercise the real subscription importer with mocked Innertube feeds. Run with node.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
const start = source.indexOf('export async function getYouTubeAccountSubscriptions()')
const end = source.indexOf('\n/**', start)
assert.ok(start >= 0 && end > start)
const importer = source.slice(start, end).replace('export async function', 'async function')

async function run(innertube) {
  const context = vm.createContext({
    getYouTubeAccountInnertube: async () => innertube,
    CHANNELS_FEED_PAGES_TO_FETCH: 100,
    getYouTubeAccountSubscriptionTabs: () => [],
    console: { warn() {} },
    Map,
    Error,
  })
  return vm.runInContext(`(${importer})()`, context)
}

const channel = (id, name) => ({ id, author: { name, best_thumbnail: { url: `https://example.com/${id}` } } })

;(async () => {
  let guideCalled = false
  const full = await run({
    getChannelsFeed: async () => ({
      channels: [channel('UC1', 'Zed')],
      has_continuation: true,
      getContinuation: async () => ({ channels: [channel('UC2', 'Amy'), channel('UC1', 'Zed')], has_continuation: false })
    }),
    getGuide: () => { guideCalled = true },
  })
  assert.equal(full.partial, false)
  assert.equal(full.channels.length, 2)
  assert.equal(full.channels[0].name, 'Amy')
  assert.equal(guideCalled, false)

  const fallback = await run({
    getChannelsFeed: async () => { throw new Error('not available') },
    getGuide: async () => ({ contents: [{ items: [{ type: 'GuideEntry', title: { text: 'A' }, endpoint: { payload: { browseId: 'UC1' } } }] }] }),
    getSubscriptionsFeed: async () => ({ videos: [{ author: { id: 'UC2', name: 'B' } }], has_continuation: false }),
  })
  assert.equal(fallback.partial, true)
  assert.equal(fallback.channels.length, 2)

  const empty = await run({
    getChannelsFeed: async () => ({ channels: [], has_continuation: false }),
    getGuide: async () => ({ contents: [] }),
    getSubscriptionsFeed: async () => ({ videos: [], has_continuation: false }),
  })
  assert.equal(empty.partial, true)
  assert.equal(empty.channels.length, 0)

  await assert.rejects(run({
    getChannelsFeed: async () => { throw new Error('no channels') },
    getGuide: async () => { throw new Error('no guide') },
    getSubscriptionsFeed: async () => { throw new Error('no feed') },
  }), /Unable to retrieve YouTube subscriptions/)

  console.log('Subscription importer tests passed')
})().catch((error) => { console.error(error); process.exitCode = 1 })
