const assert = require('node:assert/strict')
const http = require('node:http')
const { once, EventEmitter } = require('node:events')
const { createMusicControlLifecycle } = require('../src/main/musicControlLifecycle.cjs')
const { startLocalControlServer } = require('../src/main/localControlServer.cjs')
const { parseMusicSearchResults } = require('../src/renderer/helpers/api/musicSearch.cjs')
const fs = require('node:fs')
const vm = require('node:vm')

const modeCode = fs.readFileSync('src/renderer/helpers/musicMode.js', 'utf8').replace('export function', 'function')
const context = vm.createContext({})
vm.runInContext(modeCode, context)
const musicRoute = context.isMusicRoute
assert.equal(musicRoute({ path: '/music', query: {} }), true)
assert.equal(musicRoute({ path: '/watch/123', query: { music: '1' } }), true)
assert.equal(musicRoute({ path: '/playlist/123', query: { music: '1' } }), true)
assert.equal(musicRoute({ path: '/watch/123', query: {} }), false)
assert.equal(musicRoute({ path: '/settings', query: { music: '1' } }), false)
assert.equal(musicRoute({ path: '/subscriptions', query: {} }), false)

const item = { item_type: 'song', id: 'abcdefghijk', title: 'A song', artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration: { text: '3:42' }, thumbnails: [{ url: 'https://lh3.googleusercontent.com/image' }] }
const results = parseMusicSearchResults({ contents: [{ contents: [item, item, { item_type: 'artist', id: 'artist', title: 'Not a song' }, { item_type: 'song', id: 'bad', title: 'Bad' }] }] })
assert.equal(results.length, 1)
assert.deepEqual(results[0], { id: 'abcdefghijk', title: 'A song', artist: 'Artist', album: 'Album', duration: '3:42', artwork: 'https://lh3.googleusercontent.com/image', kind: 'song' })
assert.equal(parseMusicSearchResults({ contents: { contents: [{ ...item, thumbnails: [{ url: 'https://evil.invalid/image' }] }] } })[0].artwork, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg')
assert.deepEqual(parseMusicSearchResults({ contents: [] }), [])

;(async () => {
  const servers = []
  const manager = createMusicControlLifecycle(() => {
    const server = startLocalControlServer({ port: 0, getStatus: () => ({}), onCommand() {} })
    servers.push(server)
    return server
  })
  assert.equal(manager.getPhase(), 'stopped')
  manager.setActive(true)
  await once(servers[0], 'listening')
  assert.equal(manager.getPhase(), 'listening')
  const { port } = servers[0].address()
  const status = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/status`, response => { response.resume(); response.on('end', () => resolve(response.statusCode)) }).on('error', reject)
  })
  assert.equal(status, 200)
  manager.setActive(false)
  await once(servers[0], 'close')
  assert.equal(manager.getPhase(), 'stopped')
  await assert.rejects(new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/status`, resolve).on('error', reject)
  }))

  // Re-enter Music while the old listener is still closing; exactly one replacement starts.
  manager.setActive(true)
  await once(servers[1], 'listening')
  manager.setActive(false)
  manager.setActive(true)
  await once(servers[1], 'close')
  if (!servers[2].listening) await once(servers[2], 'listening')
  assert.equal(manager.getPhase(), 'listening')
  manager.setActive(false)
  await once(servers[2], 'close')

  // Leaving before listen resolves must close it as soon as it starts.
  const fake = new EventEmitter()
  fake.close = callback => { callback() }
  const pending = createMusicControlLifecycle(() => fake)
  pending.setActive(true)
  pending.setActive(false)
  fake.emit('listening')
  assert.equal(pending.getPhase(), 'stopped')
  console.log('Music search and API lifecycle tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
