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
const ctx = vm.createContext({ console: quiet, setTimeout, clearTimeout, Utils: { timeToSeconds: () => 0 }, parseListItem: x => x, ClientType: { TV: 'TV', WEB: 'WEB' }, TV_CLIENT_USER_AGENT: 'TV', Mixins: { Feed: class { constructor() { throw Error('no parser') } } } })
vm.runInContext(`${rawSource}\n${helperSource}\n${functions}`, ctx)
const hasLiveBadge = vm.runInContext('hasLiveBadge', ctx)
const makeBrowser = vm.runInContext('createDiscoveryBrowser', ctx)
const makeSearch = vm.runInContext('createInterestSearch', ctx)
assert.equal(hasLiveBadge({ title: 'LIVE' }), false)
assert.equal(hasLiveBadge({ menu: { style: 'LIVE' } }), false)
assert.equal(hasLiveBadge({ header: { tileHeaderRenderer: { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] } } }), true)
assert.equal(hasLiveBadge({ badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] }), true)
const video = n => ({ type: 'video', videoId: `id${n}`, title: `Video ${n}` })
let pageReads = 0, opens = 0
const page = n => ({ videos: Array.from({ length: 5 }, (_, i) => video(n * 5 + i)), has_continuation: n < 5, getContinuation: async () => { pageReads++; return page(n + 1) } })
;(async () => {
  const history = [
    { videoId: 'watched1', title: 'Cooking with carrots', authorId: 'cook' },
    { videoId: 'watched2', title: 'Baking bread at home', authorId: 'baker' },
    { videoId: 'watched3', title: 'Vegetable recipes', authorId: 'cook' },
  ]
  const queries = []
  const search = async query => {
    queries.push(query)
    return [{ ...video(500 + queries.length), title: `Related to ${query}` }, { ...video(999), videoId: 'watched1' }]
  }
  const browser = makeBrowser({ kind: 'discover', open: async () => { opens++; return page(0) }, search, getHistory: () => history })
  const first = await browser.refresh()
  assert.equal(queries.length, 2)
  assert.deepEqual(queries, ['Cooking with carrots', 'Vegetable recipes'], 'repeatedly watched channels are prioritised')
  assert.ok(first.some(v => v.title === 'Related to Cooking with carrots'))
  assert.ok(!first.some(v => v.videoId === 'watched1'), 'watched videos are excluded')
  const next = await browser.refresh()
  assert.equal(opens, 1, 'refresh advances the home continuation')
  assert.equal(pageReads, 5, 'small pages are read ahead rather than showing the same row')
  assert.equal(queries[2], 'Baking bread at home', 'subsequent refresh rotates through watched interests')
  assert.ok(next.some(v => !first.some(old => old.videoId === v.videoId)))
  assert.equal(new Set(next.map(v => v.videoId)).size, next.length)
  await browser.refresh()
  assert.equal(opens, 2, 'when continuation ends the home feed is requested again')

  let noHistoryQueries = 0
  const noHistory = makeBrowser({ open: async () => ({ videos: [video(1), video(2), video(3)] }), search: async () => { noHistoryQueries++; return [] } })
  await noHistory.refresh()
  assert.equal(noHistoryQueries, 0, 'never search unrelated preset topics')
  const firstOrder = Array.from(await noHistory.refresh(), v => v.videoId)
  const secondOrder = Array.from(await noHistory.refresh(), v => v.videoId)
  assert.notDeepEqual(secondOrder, firstOrder, 'an unchanged small feed does not look stuck')
  assert.equal(noHistory.getStatus().limited, true, 'reordered old items are labeled rather than presented as new')
  const again = Array.from(await noHistory.refresh(), v => v.videoId)
  assert.notDeepEqual(again, secondOrder)

  let firstSearchCalls = 0, nextSearchCalls = 0
  const pagedSearch = makeSearch({
    search: async () => { firstSearchCalls++; return { results: [video(100)], continuationData: 'cursor1' } },
    next: async cursor => { nextSearchCalls++; assert.equal(cursor, 'cursor1'); return { results: [video(101)], continuationData: null } },
  })
  assert.equal((await pagedSearch('familiar topic'))[0].videoId, 'id100')
  assert.equal((await pagedSearch('familiar topic'))[0].videoId, 'id101', 'the next refresh fetches more related results')
  await pagedSearch('familiar topic')
  assert.equal(firstSearchCalls, 2, 'an exhausted search is restarted')
  assert.equal(nextSearchCalls, 1)
  const expired = makeSearch({ search: async () => ({ results: [video(200)], continuationData: 'expired' }), next: async () => { throw Error('expired') } })
  await expired('topic')
  assert.equal((await expired('topic'))[0].videoId, 'id200', 'an expired cursor falls back to a fresh search')

  const stuck = makeBrowser({ open: () => new Promise(() => {}), search, getHistory: () => history, timeoutMs: 15 })
  assert.ok((await stuck.refresh()).length > 0)
  let releaseHome
  const delayed = new Promise(resolve => { releaseHome = resolve })
  let homeRequests = 0
  const late = makeBrowser({ open: async () => { homeRequests++; return homeRequests === 1 ? delayed : page(0) }, search, getHistory: () => history, timeoutMs: 15 })
  await late.refresh()
  releaseHome(page(0))
  await new Promise(resolve => setTimeout(resolve, 0))
  await late.refresh()
  assert.equal(homeRequests, 2, 'a timed-out request does not overwrite the next request state')
  const partial = makeBrowser({ open: async () => { throw Error('offline') }, getHistory: () => history, search: async () => [video(99)] })
  assert.equal((await partial.refresh())[0].videoId, 'id99')
  await assert.rejects(makeBrowser({ open: async () => { throw Error('offline') } }).refresh(), /No readable/)

  const nav = fs.readFileSync('src/renderer/components/SideNav/SideNav.vue', 'utf8')
  const router = fs.readFileSync('src/renderer/router/index.js', 'utf8')
  const subscriptions = fs.readFileSync('src/renderer/views/Subscriptions/Subscriptions.vue', 'utf8')
  const watchPage = fs.readFileSync('src/renderer/views/Watch/Watch.vue', 'utf8')
  assert.ok(!nav.includes('to="/live"'), 'global Live navigation is removed')
  assert.ok(router.includes("path: '/live', redirect: '/discover'"), 'old startup links remain usable')
  assert.ok(subscriptions.includes('SubscriptionsLive'), 'subscribed live streams remain available')
  assert.ok(/liveChat|live-chat|LiveChat/i.test(watchPage), 'live chat remains in the player')

  const makeTile = (id, live) => ({ tileRenderer: { contentId: id, contentType: 'TILE_CONTENT_TYPE_VIDEO', metadata: { tileMetadataRenderer: { title: { simpleText: id } } }, header: { tileHeaderRenderer: { thumbnailOverlays: live ? [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] : [] } }, onSelectCommand: { watchEndpoint: { videoId: id } } } })
  const feed = items => ({ contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items } } } } } } })
  const requests = []
  ctx.getYouTubeAccountInnertube = async () => { throw Error('account unavailable') }
  ctx.getYouTubeAccountWebInnertube = async () => { throw Error('account web unavailable') }
  ctx.createInnertube = async options => ({ actions: { execute: async (_, params) => { requests.push([options.clientType, params.browseId]); return feed([makeTile('live1', true), makeTile('vod2', false)]) } } })
  ctx.getLocalSearchResults = async () => { throw Error('should not need search') }
  const live = await vm.runInContext("openDiscoveryFeed('live')", ctx)
  assert.equal(requests[0][1], 'FEtopics_live')
  assert.deepEqual(Array.from(live.videos, v => v.videoId), ['live1'])
  assert.equal(live.videos[0].liveNow, true)

  requests.length = 0
  await assert.rejects(vm.runInContext("openDiscoveryFeed('discover', false, true)", ctx), /Unable to load/)
  assert.equal(requests.length, 0, 'signed-in browsing must not silently use an anonymous home feed')
  ctx.getYouTubeAccountWebInnertube = async () => ({ actions: { execute: async () => feed([makeTile('personalized', false)]) } })
  const signedInHome = await vm.runInContext("openDiscoveryFeed('discover', false, true)", ctx)
  assert.equal(signedInHome.videos[0].videoId, 'personalized')

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
