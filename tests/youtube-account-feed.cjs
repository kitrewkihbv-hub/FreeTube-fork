// Real raw feed extraction and activity feed fallback, with mocked Innertube.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const rawSource = fs.readFileSync('src/renderer/helpers/api/youtubeAccountRawFeed.js', 'utf8').replaceAll('export function', 'function')
const local = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
function extract(startText, endText) {
  const start = local.indexOf(startText)
  const end = local.indexOf(endText, start)
  assert.ok(start >= 0 && end > start)
  return local.slice(start, end).replace('export async function', 'async function').replace('export function', 'function')
}
const functions = [
  extract('export async function getYouTubeAccountActivityFeed()', '\n/**'),
  extract('function getYouTubeAccountFeedArray(', '\n/**'),
  extract('function getYouTubeAccountVideoFallback(', '\n/**'),
  extract('async function getYouTubeAccountRawBrowseFeed(', '\n/**'),
  extract('export function parseYouTubeAccountFeedItems(', '\n// #endregion'),
].join('\n')
const tile = { tileRenderer: { contentId: 'video123', contentType: 'TILE_CONTENT_TYPE_VIDEO', metadata: { tileMetadataRenderer: { title: { simpleText: 'A video' } } }, onSelectCommand: { watchEndpoint: { videoId: 'video123' } } } }
const response = { contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items: [tile] } } } } } } }
async function run(innertube) {
  const context = vm.createContext({ getYouTubeAccountInnertube: async () => innertube, console: { warn() {} }, Utils: { timeToSeconds: () => 0 }, parseListItem: item => { if (item.bad) throw new Error('bad item'); return item }, Error })
  vm.runInContext(`${rawSource}\n${functions}`, context)
  return vm.runInContext('getYouTubeAccountActivityFeed()', context)
}
;(async () => {
  const feed = await run({ getSubscriptionsFeed: async () => ({ videos: [{ bad: true, type: 'Video', id: 'one', title: 'Fallback' }, { type: 'video', videoId: 'two' }] }) })
  assert.deepEqual(Array.from(feed, x => x.videoId), ['one', 'two'])
  let browseId
  const fallback = await run({ getSubscriptionsFeed: async () => ({ videos: [] }), actions: { execute: async (path, options) => { assert.equal(path, '/browse'); browseId = options.browseId; return response } } })
  assert.equal(browseId, 'FEsubscriptions')
  assert.equal(fallback[0].videoId, 'video123')
  assert.equal(fallback[0].title, 'A video')
  await assert.rejects(run({ getSubscriptionsFeed: async () => { throw new Error('bad') }, actions: { execute: async () => ({}) } }), /no readable/)
  await assert.rejects(run(null), /signed in/)
  console.log('YouTube account feed fallback tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
