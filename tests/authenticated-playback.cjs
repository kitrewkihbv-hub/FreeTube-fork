// Offline contract tests: real youtubei.js HTTP auth and MacTube's player selection.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

async function testYouTubeIAuth() {
  const { Session, ClientType } = await import('youtubei.js')
  const requests = []
  const session = await Session.create({
    client_type: ClientType.TV, retrieve_player: false, retrieve_innertube_config: false, generate_session_locally: true,
    enable_session_cache: false, fetch: async (request, init) => {
      requests.push({ url: request.url, headers: init.headers, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ playabilityStatus: { status: 'OK' } }), { status: 200 })
    }
  })
  await session.signIn({ access_token: 'test-access', refresh_token: 'test-refresh', expiry_date: '2099-01-01T00:00:00.000Z' })
  await session.actions.execute('/player', { videoId: 'video123456', serviceIntegrityDimensions: { poToken: 'test-proof' } })
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /^https:\/\/www\.youtube\.com\/youtubei\/v1\/player/)
  assert.equal(requests[0].headers.get('authorization'), 'Bearer test-access')
  assert.equal(requests[0].body.context.client.clientName, 'TVHTML5')
  assert.equal(requests[0].body.serviceIntegrityDimensions.poToken, 'test-proof')

  // Exercise MacTube's per-video clone with the real youtubei.js Session/HTTPClient.
  // The challenge's visitor ID, OAuth header and proof token must match on the wire.
  const localCode = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
  const cloneStart = localCode.indexOf('function createAuthenticatedVideoSession(')
  const cloneEnd = localCode.indexOf('\n/**', cloneStart)
  assert.ok(cloneStart >= 0 && cloneEnd > cloneStart)
  const cloneContext = vm.createContext({ Session, deepCopy: x => JSON.parse(JSON.stringify(x)) })
  vm.runInContext(localCode.slice(cloneStart, cloneEnd), cloneContext)
  const originalVisitor = session.context.client.visitorData
  const first = cloneContext.createAuthenticatedVideoSession(session, 'visitor-for-challenge-A', 'proof-A')
  const second = cloneContext.createAuthenticatedVideoSession(session, 'visitor-for-challenge-B', 'proof-B')
  assert.equal(first.po_token, 'proof-A')
  assert.equal(second.po_token, 'proof-B')
  assert.equal(session.context.client.visitorData, originalVisitor, 'shared account visitor is unchanged')
  assert.notEqual(session.po_token, 'proof-A', 'video tokens are not stored on the shared account session')
  await Promise.all([
    first.actions.execute('/player', { videoId: 'video123456', serviceIntegrityDimensions: { poToken: first.po_token } }),
    second.actions.execute('/player', { videoId: 'video234567', serviceIntegrityDimensions: { poToken: second.po_token } }),
  ])
  assert.equal(requests[1].body.context.client.clientName, 'TVHTML5')
  assert.equal(requests[1].body.context.client.visitorData, 'visitor-for-challenge-A')
  assert.equal(requests[1].body.serviceIntegrityDimensions.poToken, 'proof-A')
  assert.equal(requests[1].headers.get('authorization'), 'Bearer test-access')
  assert.equal(requests[2].body.context.client.visitorData, 'visitor-for-challenge-B')
  assert.equal(requests[2].body.serviceIntegrityDimensions.poToken, 'proof-B')
  assert.equal(cloneContext.createAuthenticatedVideoSession(session, '', 'proof'), null)
  assert.equal(cloneContext.createAuthenticatedVideoSession(session, 'visitor', ''), null)
  assert.equal(cloneContext.createAuthenticatedVideoSession({ ...session, logged_in: false }, 'visitor', 'proof'), null)

  // Force expiry after sign-in: youtubei.js should refresh before the next request
  // and emit the new credentials so MacTube can persist them.
  let updated
  let refreshCalls = 0
  const localSource = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
  const wrapperStart = localSource.indexOf('function createAccountFetch(')
  const wrapperEnd = localSource.indexOf('\n/**', wrapperStart)
  const wrapperContext = vm.createContext({
    URL, accountSessionGeneration: 0,
    fetch: async (request, init) => {
      if (String(request).includes('/o/oauth2/token')) {
        refreshCalls++
        return new Response(JSON.stringify({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh', expires_in: 3600 }), { status: 200 })
      }
      assert.equal(init.headers.get('authorization'), 'Bearer refreshed-access')
      return new Response('{}', { status: 200 })
    }
  })
  vm.runInContext(localSource.slice(wrapperStart, wrapperEnd), wrapperContext)
  let refreshedSession
  const accountFetch = wrapperContext.createAccountFetch(() => ({ session: refreshedSession }), 0)
  refreshedSession = await Session.create({
    client_type: ClientType.TV, retrieve_player: false, retrieve_innertube_config: false,
    generate_session_locally: true, enable_session_cache: false, fetch: accountFetch,
  })
  refreshedSession.on('update-credentials', ({ credentials }) => { updated = { ...credentials } })
  await refreshedSession.signIn({ access_token: 'old-access', refresh_token: 'test-refresh', expiry_date: '2099-01-01T00:00:00.000Z', client: { client_id: 'test', client_secret: 'test' } })
  refreshedSession.oauth.oauth2_tokens.expiry_date = '2000-01-01T00:00:00.000Z'
  const refreshClone = cloneContext.createAuthenticatedVideoSession(refreshedSession, 'same-visitor', 'proof-refresh')
  await refreshClone.actions.execute('/player', { videoId: 'video123456', serviceIntegrityDimensions: { poToken: refreshClone.po_token } })
  assert.equal(refreshCalls, 1)
  assert.equal(updated.access_token, 'refreshed-access')
  assert.equal(updated.refresh_token, 'rotated-refresh')
  assert.equal(refreshedSession.oauth.oauth2_tokens.refresh_token, 'rotated-refresh')
}

async function testSelection({ candidate, signedIn = true, isLive = false, invalidate = false, badTvParser = false, missingVisitor = false }) {
  const source = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
  const extract = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a)
    assert.ok(a >= 0 && b > a)
    return source.slice(a, b).replace('export async function', 'async function')
  }
  const functions = extract('function createPlayerRequestBody(', '\n/**') + '\n' +
    extract('function createWatchNextRequestBody(', '\n/**') + '\n' +
    extract('export async function getLocalVideoInfo(', '\n/**')
  const events = [], calls = []
  const webContext = { client: { clientName: 'WEB', clientVersion: '1', visitorData: missingVisitor ? '' : 'proof-visitor' } }
  const tvContext = { client: { clientName: 'TVHTML5', clientVersion: '2', visitorData: 'original-tv-visitor' } }
  const webPlayer = { playabilityStatus: { status: 'OK' }, videoDetails: {}, streamingData: { formats: [{ id: 'web' }] } }
  const tv = { session: { context: tvContext, actions: { execute: async (path, body) => {
    events.push('tv-player'); calls.push({ path, body })
    if (invalidate) vm.runInContext('accountSessionGeneration++', context)
    if (candidate instanceof Error) throw candidate
    return { data: candidate }
  } } } }
  class VideoInfo {
    constructor([player, next]) {
      if (badTvParser && player.data === candidate) throw Error('unsupported TV response')
      this.player = player.data
      this.next = next.data
      this.playability_status = { status: player.data.playabilityStatus.status }
      this.has_trailer = false
      this.getTrailerInfo = () => ({})
      this.basic_info = {}
      this.streaming_data = { formats: [], adaptive_formats: [], ...(isLive && player.data === candidate ? { hls_manifest_url: 'https://example.com/live?x=1' } : {}) }
    }
  }
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: true } }, accountSessionGeneration: 0,
    getYouTubeAccountInnertube: async () => { events.push('session'); return signedIn ? tv : null },
    getWatchHTMLWatchPage: async () => { events.push('html'); return { session: { context: webContext, actions: { execute: async path => { events.push(`web-${path}`); throw new Error('unexpected web request') } } }, playerResponse: webPlayer, nextResponse: { metadata: 'web' }, initialAttestationData: { challenge: true }, ytConfig: {}, playerId: 'player' } },
    window: { ftElectron: { generatePoToken: async (_id, contextJson) => { events.push('proof'); assert.equal(JSON.parse(contextJson).client.clientName, 'WEB'); return 'test-proof' } } },
    Player: { create: async () => ({ signature_timestamp: 42, decipher: async url => url }) }, PlayerCache: class {}, UniversalCache: class {},
    YT: { VideoInfo }, Utils: { generateRandomString: () => 'cpn' }, Constants: { CLIENT_NAME_IDS: { WEB: '1', TVHTML5: '7' } },
    extractTotalAdTimeMilliseconds: () => 0, extractLocalContentDisclosures: () => null,
    createYouTubeWatchTracker: () => ({ update() {} }),
    createAuthenticatedVideoSession: (original, visitor, token) => {
      assert.equal(original, tv.session)
      if (missingVisitor) { assert.equal(visitor, ''); return null }
      assert.equal(visitor, 'proof-visitor')
      assert.equal(token, 'test-proof')
      return { ...original, context: { client: { ...original.context.client, visitorData: visitor } }, po_token: token }
    },
    decipherFormats: async () => {}, decipherManifestUrl: async url => url,
    createInnertube: async () => { throw Error('unexpected fallback') }, ClientType: {}, console: { warn() {}, error() {} }, Date,
  })
  vm.runInContext(functions, context)
  const result = await vm.runInContext("getLocalVideoInfo('video123456')", context)
  assert.equal(events[0], 'session', 'account session initializes before HTML or player access')
  assert.equal(result.info.next.metadata, 'web', 'Web watch-next metadata is preserved')
  if (signedIn && !missingVisitor) {
    assert.equal(calls[0].path, '/player')
    assert.equal(calls[0].body.videoId, 'video123456')
    assert.equal(calls[0].body.serviceIntegrityDimensions.poToken, 'test-proof')
  } else assert.equal(calls.length, 0)
  const usesTv = signedIn && !missingVisitor && !invalidate && !badTvParser && !(candidate instanceof Error) && candidate?.playabilityStatus?.status === 'OK' && candidate?.streamingData
  assert.equal(result.info.player, usesTv ? candidate : webPlayer)
  assert.equal(result.clientInfo.clientName, usesTv ? '7' : '1')
  if (isLive) assert.ok(!events.includes('web-/player'), 'TV live playback does not overwrite the authenticated response with an anonymous MWEB response')
}

;(async () => {
  await testYouTubeIAuth()
  const valid = { playabilityStatus: { status: 'OK' }, videoDetails: {}, streamingData: { adaptiveFormats: [{}] } }
  await testSelection({ candidate: valid })
  await testSelection({ candidate: { playabilityStatus: { status: 'LOGIN_REQUIRED' } } })
  await testSelection({ candidate: new Error('offline') })
  await testSelection({ candidate: valid, signedIn: false })
  await testSelection({ candidate: valid, invalidate: true })
  await testSelection({ candidate: valid, badTvParser: true })
  await testSelection({ candidate: valid, missingVisitor: true })
  await testSelection({ candidate: { playabilityStatus: { status: 'OK' }, videoDetails: { isLive: true }, streamingData: { hlsManifestUrl: 'https://example.com/live' } }, isLive: true })
  console.log('Authenticated playback tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
