// Real raw extraction, account client fallback and bounded channel-upload fallback.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const rawSource = fs.readFileSync('src/renderer/helpers/api/youtubeAccountRawFeed.js', 'utf8').replaceAll('export function', 'function')
const discoverySource = fs.readFileSync('src/renderer/helpers/api/discoveryFeed.js', 'utf8').replaceAll('export function', 'function')
const activity = fs.readFileSync('src/renderer/helpers/api/youtubeAccountActivity.js', 'utf8').replaceAll('export async function', 'async function')
const local = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
function extract(startText, endText) {
  const start = local.indexOf(startText)
  const end = local.indexOf(endText, start)
  assert.ok(start >= 0 && end > start)
  return local.slice(start, end).replaceAll('export async function', 'async function').replace('export function', 'function')
}
const functions = [
  extract('export async function getYouTubeAccountActivityFeed()', '\n/**'),
  extract('function getYouTubeAccountFeedArray(', '\n/**'),
  extract('function getYouTubeAccountHistoryVideos(', '\n/**'),
  extract('function getYouTubeAccountVideoFallback(', '\n/**'),
  extract('async function getYouTubeAccountRawBrowseFeed(', '\n/**'),
  extract('export function parseYouTubeAccountFeedItems(', '\n// #endregion'),
].join('\n')
const tile = { tileRenderer: { contentId: 'video123', contentType: 'TILE_CONTENT_TYPE_VIDEO', metadata: { tileMetadataRenderer: { title: { simpleText: 'A video' } } }, onSelectCommand: { watchEndpoint: { videoId: 'video123' } } } }
const response = { contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items: [tile] } } } } } } }
function setup(tv, web, subscriptions = async () => { throw Error('no subscriptions') }, channelVideos = async () => {}) {
  const context = vm.createContext({ getYouTubeAccountInnertube: async () => tv, getYouTubeAccountWebInnertube: async () => web, getYouTubeAccountSubscriptions: subscriptions, getLocalChannelVideos: channelVideos, console: { warn() {} }, Utils: { timeToSeconds: () => 0 }, parseListItem: item => { if (item.bad) throw new Error('bad item'); return item }, Error })
  vm.runInContext(`${rawSource}\n${discoverySource}\n${activity}\n${functions}`, context)
  return () => vm.runInContext('getYouTubeAccountActivityFeed()', context)
}
const emptyClient = { getSubscriptionsFeed: async () => ({ videos: [] }), actions: { execute: async () => ({}) } }
;(async () => {
  let browseId
  const raw = await setup({ ...emptyClient, actions: { execute: async (path, options) => { assert.equal(path, '/browse'); browseId = options.browseId; return response } } }, emptyClient)()
  assert.equal(browseId, 'FEsubscriptions')
  assert.equal(raw.videos[0].videoId, 'video123')
  assert.equal(raw.videos[0].title, 'A video')
  assert.equal(raw.source, 'youtube')

  const web = await setup(emptyClient, { ...emptyClient, getSubscriptionsFeed: async () => ({ videos: [{ bad: true, type: 'Video', id: 'one', title: 'Fallback' }], has_continuation: true, getContinuation: async () => ({ videos: [{ type: 'video', videoId: 'two' }] }) }) })()
  assert.deepEqual(Array.from(web.videos, x => x.videoId), ['one', 'two'])

  // Small first pages should not hide newer videos from other subscriptions.
  let continuationCalls = 0
  const manyPage = page => ({ videos: [{ type: 'video', videoId: `page${page}`, authorId: `channel${page}` }], has_continuation: page < 4, getContinuation: async () => { continuationCalls++; return manyPage(page + 1) } })
  const pages = await setup({ ...emptyClient, getSubscriptionsFeed: async () => manyPage(0) }, emptyClient)()
  assert.ok(pages.videos.some(item => item.videoId === 'page4'))
  assert.ok(continuationCalls >= 4)
  assert.equal(new Set(pages.videos.map(item => item.videoId)).size, pages.videos.length)
  assert.equal(pages.partial, true, 'a small feed without a channel fallback is marked partial')

  const mixed = await setup({ ...emptyClient, getSubscriptionsFeed: async () => ({ videos: [{ type: 'video', videoId: 'feed', authorId: 'UC1' }] }) }, emptyClient,
    async () => ({ channels: [{ id: 'UC2', name: 'Subscribed' }], partial: false }),
    async () => ({ videos: [{ type: 'video', videoId: 'upload', authorId: 'not-the-channel' }] }))()
  assert.equal(mixed.source, 'mixed')
  assert.ok(mixed.videos.some(item => item.videoId === 'feed'))
  assert.equal(mixed.videos.find(item => item.videoId === 'upload').authorId, 'UC2', 'fallback uploads belong to the subscribed channel')

  const requested = []
  const channels = Array.from({ length: 45 }, (_, n) => ({ id: `UC${n}`, name: `Channel ${n}` }))
  const fallback = await setup(emptyClient, emptyClient, async () => ({ channels, partial: true }), async id => { requested.push(id); if (id === 'UC1') throw Error('offline'); return { videos: [{ type: 'video', videoId: id, published: Number(id.slice(2)) }] } })()
  assert.equal(fallback.source, 'channelUploads')
  assert.equal(fallback.partial, true)
  assert.equal(fallback.channelCount, 40)
  assert.equal(fallback.failedChannelCount, 1)
  assert.equal(requested.length, 40)
  assert.equal(fallback.videos[0].videoId, 'UC39')
  assert.ok(fallback.videos.every(x => requested.includes(x.authorId)))
  await assert.rejects(setup(emptyClient, emptyClient)(), /no readable/)
  await assert.rejects(setup(null, emptyClient)(), /signed in/)
  console.log('YouTube account feed fallback tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
