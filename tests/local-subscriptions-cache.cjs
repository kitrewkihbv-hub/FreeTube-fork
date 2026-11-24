// Exercise the actual local subscriptions cache and async refresh routines.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/components/SubscriptionsVideos.vue', 'utf8')
const start = source.indexOf('function loadVideosFromCacheSometimes()')
const end = source.indexOf('async function getChannelVideosLocalScraper(', start)
assert.ok(start >= 0 && end > start)
let finishWrite
const context = vm.createContext({
  subscriptionCacheReady: { value: true },
  videoCacheForAllActiveProfileChannelsPresent: { value: false },
  cacheEntriesForAllActiveProfileChannels: { value: [{ videos: [{ videoId: 'cached' }] }, { videos: null }] },
  fetchSubscriptionsAutomatically: { value: false },
  activeSubscriptionList: { value: [{ id: 'UC1' }] },
  backendPreference: { value: 'local' }, useRssFeeds: { value: false },
  videoList: { value: [] }, attemptedFetch: { value: false }, isLoading: { value: true },
  errorChannels: { value: [] }, lastRemoteRefreshSuccessTimestamp: { value: null },
  process: { env: { SUPPORTS_LOCAL_API: true } },
  getChannelVideosLocalScraper: async () => ({ videos: [{ videoId: 'fresh' }] }),
  updateVideoListAfterProcessing: items => items,
  store: { commit() {}, dispatch(name) { return name === 'updateSubscriptionVideosCacheByChannel' ? new Promise(resolve => { finishWrite = resolve }) : Promise.resolve() } },
})
vm.runInContext(source.slice(start, end), context)
;(async () => {
  context.loadVideosFromCacheSometimes()
  assert.equal(context.videoList.value[0].videoId, 'cached')
  assert.equal(context.isLoading.value, false)
  const pending = context.loadVideosForSubscriptionsFromRemote()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.isLoading.value, true)
  assert.equal(typeof finishWrite, 'function')
  finishWrite()
  await pending
  assert.equal(context.isLoading.value, false)
  assert.equal(context.videoList.value[0].videoId, 'fresh')
  console.log('Local subscription cache tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
