// Test session reuse, credential persistence and sign-out races without real credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
const a = source.indexOf('/** @type {YouTubeAccountTokens | null} */')
const b = source.indexOf('/**\n * Creates a signed-in WEB client', a)
assert.ok(a >= 0 && b > a)
const code = source.slice(a, b).replaceAll('export function', 'function').replaceAll('export async function', 'async function')
let resolvesTokens, creates = 0, listener, saved = []
let tokensPromise = Promise.resolve({ access_token: 'old', refresh_token: 'refresh', expiry_date: '2099' })
const context = vm.createContext({
  process: { env: { IS_ELECTRON: true } },
  window: { ftElectron: { getAccountTokens: () => tokensPromise, updateAccountTokens: async tokens => { saved.push(tokens) } } },
  ClientType: { TV: 'TVHTML5' }, TV_CLIENT_USER_AGENT: 'tv', console,
  createInnertube: async options => {
    creates++
    assert.equal(options.clientType, 'TVHTML5')
    return { session: { logged_in: false, on: (_name, callback) => { listener = callback }, async signIn(tokens) { assert.equal(tokens.access_token, 'old'); this.logged_in = true } } }
  },
})
vm.runInContext(code, context)
const get = () => vm.runInContext('getYouTubeAccountInnertube()', context)
const clear = () => vm.runInContext('clearYouTubeAccountSession()', context)
;(async () => {
  const [one, two] = await Promise.all([get(), get()])
  assert.equal(one, two)
  assert.equal(creates, 1, 'concurrent startup/player calls share one session')
  listener({ credentials: { access_token: 'fresh', refresh_token: 'refresh', expiry_date: 'later' } })
  await Promise.resolve()
  assert.equal(saved[0].access_token, 'fresh')
  clear()
  listener({ credentials: { access_token: 'stale', refresh_token: 'refresh' } })
  assert.equal(saved.length, 1, 'old sessions cannot save tokens after sign-out')

  tokensPromise = new Promise(resolve => { resolvesTokens = resolve })
  const pending = get()
  clear()
  resolvesTokens({ access_token: 'old', refresh_token: 'refresh' })
  assert.equal(await pending, null, 'a delayed disk read cannot restore a signed-out session')
  tokensPromise = Promise.resolve(null)
  assert.equal(await get(), null)
  assert.equal(creates, 1)
  console.log('YouTube account session tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
