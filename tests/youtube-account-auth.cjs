// Offline regression for real main-process storage/refresh and renderer 401 handling.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const mainSource = fs.readFileSync('src/main/youtubeAccount.js', 'utf8').replace(/^import .*\n/gm, '').replaceAll('export ', '')
const local = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
const wrapper = local.slice(local.indexOf('function createAccountFetch('), local.indexOf('\n/**', local.indexOf('function createAccountFetch(')))

async function mainAccount(dir, tokens, request) {
  await fsp.writeFile(path.join(dir, 'youtube-account.json'), JSON.stringify({ encrypted: false, data: JSON.stringify({ tokens }) }))
  const context = vm.createContext({
    app: { whenReady: async () => {} }, safeStorage: { isEncryptionAvailable: () => false },
    existsSync: fs.existsSync, asyncFs: fsp, path, Buffer, console: { warn() {}, error() {} },
    AbortController, setTimeout, clearTimeout, fetch: request,
  })
  vm.runInContext(mainSource, context)
  context.initYoutubeAccount(dir)
  await context.loadAccountState()
  return context
}

;(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mactube-auth-test-'))
  const now = Date.now()
  const tokens = { access_token: 'old', refresh_token: 'refresh', expiry_date: new Date(now + 4 * 60000).toISOString(), expires_in: 3600, client: { client_id: 'id', client_secret: 'secret' } }
  let release, calls = 0
  try {
    const request = async (url, options) => {
      calls++
      assert.equal(url, 'https://www.youtube.com/o/oauth2/token')
      const body = JSON.parse(options.body)
      assert.equal(body.grant_type, 'refresh_token')
      assert.equal(body.refresh_token, 'refresh')
      assert.equal(body.client_id, 'id')
      assert.equal(body.client_secret, 'secret')
      await new Promise(resolve => { release = resolve })
      return { ok: true, json: async () => ({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }) }
    }
    const account = await mainAccount(dir, tokens, request)
    assert.equal(account.getAccountTokens().expiry_date, tokens.expiry_date, 'old expires_in cannot extend the token lifetime')
    assert.equal(account.getAccountTokens().expires_in, undefined)
    const requests = [account.ensureValidYouTubeAuth(), account.ensureValidYouTubeAuth(), account.ensureValidYouTubeAuth('old')]
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls, 1, 'refresh is single-flight across windows')
    release()
    const [a, b, c] = await Promise.all(requests)
    assert.equal(a.access_token, 'new')
    assert.equal(b.refresh_token, 'rotated')
    assert.equal(c.access_token, 'new')
    assert.ok(Date.parse(a.expiry_date) > Date.now() + 3500000)
    const stored = JSON.parse(JSON.parse(await fsp.readFile(path.join(dir, 'youtube-account.json'), 'utf8')).data)
    assert.equal(stored.tokens.access_token, 'new')
    assert.equal(stored.tokens.refresh_token, 'rotated')
    assert.equal(stored.tokens.client.client_id, 'id')
    assert.equal(stored.tokens.expires_in, undefined)
    await account.updateAccountTokens({ ...a, access_token: 'stale', expiry_date: '2099-01-01T00:00:00Z' }, 'old')
    assert.equal(account.getAccountTokens().access_token, 'new', 'a stale renderer cannot overwrite newer credentials')
    assert.equal((await account.ensureValidYouTubeAuth('old')).access_token, 'new', 'a late stale 401 cannot trigger another refresh')
    assert.equal(calls, 1)
    account.rejectYouTubeAccountToken('new')
    await assert.rejects(account.ensureValidYouTubeAuth(), /rejected/)

    // A refresh that returns after sign-out must not persist or revive the account.
    const late = await mainAccount(dir, tokens, request)
    const pending = late.ensureValidYouTubeAuth()
    await new Promise(resolve => setImmediate(resolve))
    const waiting = pending.catch(error => error)
    await late.signOut()
    release()
    assert.match((await waiting).message, /session changed/)
    assert.equal(late.getAccountTokens(), null)
    assert.equal(fs.existsSync(path.join(dir, 'youtube-account.json')), false)

    // QR token exchange keeps the absolute expiry and original TV client, but
    // never saves expires_in where youtubei.js could restart its lifetime.
    const signedIn = await mainAccount(dir, tokens, async (_url, options) => {
      assert.equal(JSON.parse(options.body).grant_type, 'http://oauth.net/grant_type/device/1.0')
      return { ok: true, json: async () => ({ access_token: 'qr-access', refresh_token: 'qr-refresh', expires_in: 3600 }) }
    })
    const qrTokens = await vm.runInContext("pollForAccessToken({ client_id: 'qr-id', client_secret: 'qr-secret' }, 'device')", signedIn)
    assert.equal(qrTokens.expires_in, undefined)
    assert.equal(qrTokens.client.client_id, 'qr-id')
    assert.ok(Date.parse(qrTokens.expiry_date) > Date.now() + 3500000)

    // Even an unexpired token must refresh after YouTube rejects it.
    let forcedCalls = 0
    const stillValid = { ...tokens, expires_in: undefined, expiry_date: new Date(Date.now() + 3600000).toISOString() }
    const forcedAccount = await mainAccount(dir, stillValid, async (_url, options) => {
      forcedCalls++
      assert.equal(JSON.parse(options.body).refresh_token, 'refresh')
      return { ok: true, json: async () => ({ access_token: 'forced-new', expires_in: 3600 }) }
    })
    assert.equal((await forcedAccount.ensureValidYouTubeAuth()).access_token, 'old')
    assert.equal(forcedCalls, 0)
    assert.equal((await forcedAccount.ensureValidYouTubeAuth('old')).access_token, 'forced-new')
    assert.equal(forcedCalls, 1)
    assert.equal(forcedAccount.getAccountTokens().refresh_token, 'refresh', 'missing rotated token keeps the previous one')

    // Invalid refresh response fails safely without changing stored credentials.
    const bad = await mainAccount(dir, tokens, async () => ({ ok: true, json: async () => ({ error: 'invalid_grant' }) }))
    await assert.rejects(bad.ensureValidYouTubeAuth(), /invalid credentials/)
    assert.equal(bad.getAccountTokens().access_token, 'old')

    let sent = 0, forced = 0, rejected = 0
    const initial = { access_token: 'old' }, fresh = { access_token: 'fresh' }
    const context = vm.createContext({ URL, Headers, accountSessionGeneration: 0,
      window: { ftElectron: { rejectYouTubeAccountToken: async token => { assert.equal(token, 'fresh'); rejected++ } } },
      ensureValidYouTubeAuth: async token => { if (token) { forced++; return fresh } return initial },
      fetch: async (_input, init) => { sent++; assert.equal(init.headers.get('authorization'), sent === 1 ? 'Bearer old' : 'Bearer fresh'); return new Response('{}', { status: 401 }) },
    })
    vm.runInContext(wrapper, context)
    const wrapped = context.createAccountFetch(() => null, 0)
    await assert.rejects(wrapped('https://www.youtube.com/youtubei/v1/browse', { headers: { authorization: 'Bearer old' }, body: '{}' }), error => error.code === 'YOUTUBE_AUTH_FAILED')
    assert.equal(sent, 2, 'one initial request and one retry')
    assert.equal(forced, 1)
    assert.equal(rejected, 1)

    // A history failure must not cascade to raw, library or playlist endpoints.
    const begin = local.indexOf('async function getYouTubeAccountHistoryFeed(')
    const end = local.indexOf('\n/**', begin)
    const historySource = local.slice(begin, end)
    let fallbackCalls = 0
    const authError = Object.assign(new Error('unauthorized'), { code: 'YOUTUBE_AUTH_FAILED' })
    const history = vm.createContext({ console: { warn() {} }, getYouTubeAccountHistoryVideos: () => [], getYouTubeAccountRawBrowseFeed: async () => { fallbackCalls++ } })
    vm.runInContext(historySource, history)
    await assert.rejects(history.getYouTubeAccountHistoryFeed({ getHistory: async () => { throw authError }, getLibrary: async () => { fallbackCalls++ }, getPlaylist: async () => { fallbackCalls++ } }, 'TV'), error => error === authError)
    assert.equal(fallbackCalls, 0)
    const pstart = local.indexOf('export async function getYouTubeAccountPlaylists()')
    const pend = local.indexOf('\n/**', pstart)
    const playlistSource = local.slice(pstart, pend).replace('export async function', 'async function')
    const playlist = vm.createContext({
      getYouTubeAccountInnertube: async () => ({ getPlaylists: async () => { throw authError } }),
      getYouTubeAccountWebInnertube: async () => { fallbackCalls++ }, YOUTUBE_ACCOUNT_PLAYLIST_CONTENT_PAGES_TO_FETCH: 100, Map, console: { warn() {} }
    })
    vm.runInContext(playlistSource, playlist)
    await assert.rejects(playlist.getYouTubeAccountPlaylists(), error => error === authError)
    assert.equal(fallbackCalls, 0, '401 never cascades through playlist fallbacks')
    console.log('YouTube authentication refresh tests passed')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
