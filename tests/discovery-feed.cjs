// Tests real discovery paging, refresh variation, live badge detection, and API fallback.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const rawSource = fs.readFileSync('src/renderer/helpers/api/youtubeAccountRawFeed.js', 'utf8').replaceAll('export function', 'function')
const helperSource = fs.readFileSync('src/renderer/helpers/api/discoveryFeed.js', 'utf8').replaceAll('export function', 'function')
const local = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
function extract(startText, endText) {
  const start = local.indexOf(startText), end = local.indexOf(endText, start)
  assert.ok(start >= 0 && end > start)
  return local.slice(start, end).replace('export async function', 'async function').replace('export function', 'function')
}
const functions = [
  extract('function getYouTubeAccountFeedArray(', '\n/**'),
  extract('function getYouTubeAccountHistoryVideos(', '\n/**'),
  extract('function getYouTubeAccountVideoFallback(', '\n/**'),
  extract('export function parseYouTubeAccountFeedItems(', '\n/**\n * Open YouTube'),
  extract('export async function openDiscoveryFeed(', '\n// #endregion'),
].join('\n')
const quiet = { warn() {} }
const ctx = vm.createContext({ console: quiet, Utils: { timeToSeconds: () => 0 }, parseListItem: x => x, ClientType: { TV: 'TV', WEB: 'WEB' }, TV_CLIENT_USER_AGENT: 'TV', Mixins: { Feed: class { constructor() { throw Error('no parser') } } } })
vm.runInContext(`${rawSource}\n${helperSource}\n${functions}`, ctx)
const hasLiveBadge = vm.runInContext('hasLiveBadge', ctx)
const makeBrowser = vm.runInContext('createDiscoveryBrowser', ctx)
assert.equal(hasLiveBadge({ title: 'LIVE' }), false)
assert.equal(hasLiveBadge({ menu: { style: 'LIVE' } }), false)
assert.equal(hasLiveBadge({ header: { tileHeaderRenderer: { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] } } }), true)
assert.equal(hasLiveBadge({ badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] }), true)
const video = n => ({ type: 'video', videoId: `id${n}`, title: `Video ${n}` })
let pageReads = 0, opens = 0
const page = n => ({ videos: Array.from({ length: 15 }, (_, i) => video(n * 15 + i)), has_continuation: n < 5, getContinuation: async () => { pageReads++; return page(n + 1) } })
;(async () => {
  const browser = makeBrowser({ kind: 'discover', open: async () => { opens++; return page(0) }, random: () => 0.4 })
  const first = await browser.refresh()
  assert.equal(first.length, 36)
  assert.equal(pageReads, 2)
  const next = await browser.refresh()
  assert.equal(opens, 1, 'refresh advances continuation instead of reloading the first shelf')
  assert.equal(pageReads, 5)
  assert.ok(next.filter(v => !first.some(old => old.videoId === v.videoId)).length > 0)
  assert.equal(new Set(next.map(v => v.videoId)).size, next.length)
  await browser.refresh()
  assert.equal(opens, 2, 'when continuation ends the home feed is requested again')

  const liveBrowser = makeBrowser({ kind: 'live', open: async () => ({ videos: [{ ...video(1), liveNow: true }, video(2)], has_continuation: false }) })
  assert.deepEqual(Array.from(await liveBrowser.refresh(), v => v.videoId), ['id1'])
  await assert.rejects(makeBrowser({ kind: 'live', open: async () => ({ videos: [video(2)] }) }).refresh(), /No readable/)

  const makeTile = (id, live) => ({ tileRenderer: { contentId: id, contentType: 'TILE_CONTENT_TYPE_VIDEO', metadata: { tileMetadataRenderer: { title: { simpleText: id } } }, header: { tileHeaderRenderer: { thumbnailOverlays: live ? [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] : [] } }, onSelectCommand: { watchEndpoint: { videoId: id } } } })
  const feed = items => ({ contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items } } } } } } })
  const requests = []
  ctx.getYouTubeAccountInnertube = async () => { throw Error('account unavailable') }
  ctx.createInnertube = async options => ({ actions: { execute: async (_, params) => { requests.push([options.clientType, params.browseId]); return feed([makeTile('live1', true), makeTile('vod2', false)]) } } })
  ctx.getLocalSearchResults = async () => { throw Error('should not need search') }
  const live = await vm.runInContext("openDiscoveryFeed('live')", ctx)
  assert.equal(requests[0][1], 'FEtopics_live')
  assert.deepEqual(Array.from(live.videos, v => v.videoId), ['live1'])
  assert.equal(live.videos[0].liveNow, true)

  requests.length = 0
  ctx.getYouTubeAccountInnertube = async () => { throw Error('must skip account in restricted mode') }
  const home = await vm.runInContext("openDiscoveryFeed('discover', true)", ctx)
  assert.equal(requests[0][1], 'FEwhat_to_watch')
  assert.equal(home.videos.length, 2)

  ctx.createInnertube = async () => { throw Error('unavailable') }
  ctx.getLocalSearchResults = async (query, filters, safe) => { assert.equal(query, 'live'); assert.equal(filters.features[0], 'live'); assert.equal(safe, true); return { results: [{ ...video(7), liveNow: true }, video(8)] } }
  const searchFallback = await vm.runInContext("openDiscoveryFeed('live', true)", ctx)
  assert.deepEqual(Array.from(searchFallback.videos, v => v.videoId), ['id7'])
  console.log('Discovery and live feed tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
