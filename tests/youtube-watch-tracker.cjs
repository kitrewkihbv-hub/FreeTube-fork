const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/helpers/api/youtubeWatchTracker.js', 'utf8').replace('export function', 'function')
const context = vm.createContext({ URL })
vm.runInContext(source, context)
const makeTracker = vm.runInContext('createYouTubeWatchTracker', context)
const tracking = {
  videostatsPlaybackUrl: { baseUrl: 'https://s.youtube.com/api/stats/playback?token=example' },
  videostatsWatchtimeUrl: { baseUrl: 'https://s.youtube.com/api/stats/watchtime?token=example' },
}
const calls = []
let clock = 100000, active = true
const session = { context: { client: { clientName: 'TVHTML5', clientVersion: '2.0' } }, http: { fetch: async (url, options) => { calls.push({ url, options }) } } }
const make = (overrides = {}) => makeTracker({ session, tracking, cpn: 'cpn', isActive: () => active, now: () => clock, ...overrides })
;(async () => {
  assert.equal(make({ tracking: { ...tracking, videostatsPlaybackUrl: { baseUrl: 'https://evil.example/api/stats/playback' } } }), null)
  assert.equal(make({ tracking: { ...tracking, videostatsPlaybackUrl: { baseUrl: 'http://www.youtube.com/api/stats/playback' } } }), null)
  assert.equal(make({ tracking: { ...tracking, videostatsWatchtimeUrl: { baseUrl: 'https://youtube.com.evil.example/api/stats/watchtime' } } }), null)
  assert.equal(make({ tracking: { ...tracking, videostatsWatchtimeUrl: { baseUrl: 'https://www.youtube.com/other' } } }), null)
  assert.equal(make({ tracking: {} }), null)
  const tracker = make()
  await tracker.update(1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.origin, 'https://www.youtube.com')
  assert.equal(calls[0].url.pathname, '/api/stats/playback')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[0].url.searchParams.get('c'), 'tvhtml5')
  clock += 44999
  await tracker.update(2)
  assert.equal(calls.length, 1)
  clock++
  await tracker.update(3)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.pathname, '/api/stats/watchtime')
  assert.equal(calls[1].url.searchParams.get('st'), '1.000')
  assert.equal(calls[1].url.searchParams.get('et'), '3.000')
  clock += 45000
  await tracker.update(200)
  assert.equal(calls[2].url.searchParams.get('st'), '200.000', 'seeks do not count as watched duration')
  active = false
  clock += 50000
  await tracker.update(201)
  assert.equal(calls.length, 3, 'sign-out or inactive session stops reporting')
  let failures = 0
  active = true
  const failing = make({ session: { ...session, http: { fetch: async () => { failures++; throw Error('offline') } } } })
  await failing.update(1)
  await failing.update(2)
  assert.equal(failures, 1, 'failed attempts are also throttled')
  clock += 45000
  await failing.update(3)
  assert.equal(failures, 2)
  console.log('YouTube watch tracking tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
