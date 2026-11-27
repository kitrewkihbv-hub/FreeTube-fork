// Offline contract tests: real youtubei.js HTTP auth and MacTube's player selection.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')


async function testFreshChallenge() {
  const source = fs.readFileSync('src/botGuardScript.js', 'utf8').replace(/^import .*$/gm, '').replace('export default async function (', 'async function mint(')
  const requests = []
  const challenge = { bgChallenge: { interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: 'https://example.com/vm' }, program: 'new-program', globalName: 'bg' } }
  const context = vm.createContext({
    window: {},
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url.includes('/att/get')) return { ok: true, json: async () => challenge }
      if (url === 'https://example.com/vm') return { ok: true, text: async () => 'window.loaded = true' }
      return { ok: true, json: async () => ['integrity'] }
    },
    BotGuardClient: { create: async options => {
      assert.equal(options.program, 'new-program')
      return { snapshot: async () => 'snapshot' }
    } },
    WebPoMinter: { create: async () => ({ mintAsWebsafeString: async id => { assert.equal(id, 'video123456'); return 'proof' } }) },
    buildURL: () => 'https://example.com/integrity', GOOG_API_KEY: 'test'
  })
  vm.runInContext(source, context)
  const webContext = { client: { visitorData: 'fresh-visitor', clientVersion: '1' } }
  const attestation = { T: 'attestation', R: { bgChallenge: { interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: 'https://example.com/old' }, program: 'old' } } }
  assert.equal(await context.mint('video123456', webContext, attestation, {}, true), 'proof')
  assert.equal(requests.length, 3)
  assert.equal(requests[0].options.headers['X-Goog-Visitor-Id'], 'fresh-visitor')
  assert.equal(JSON.parse(requests[0].options.body).context.client.visitorData, 'fresh-visitor')
  assert.equal(requests[1].url, 'https://example.com/vm', 'fresh challenge is used instead of embedded challenge')
  context.WebPoMinter.create = async () => ({ mintAsWebsafeString: async () => '' })
  await assert.rejects(context.mint('video123456', webContext, attestation, {}, true), /empty proof token/)
}

async function testRealWire() {
  const { Session, ClientType, Constants } = await import('youtubei.js')
  const local = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
  const extract = start => {
    const a = local.indexOf(start), b = local.indexOf('\n/**', a)
    assert.ok(a >= 0 && b > a)
    return local.slice(a, b)
  }
  const ctx = vm.createContext({ Session, Constants, ClientType, deepCopy: value => JSON.parse(JSON.stringify(value)), createInnertube: async options => ({ session: await Session.create({ client_type: options.clientType, user_agent: options.userAgent, retrieve_player: false, retrieve_innertube_config: false, generate_session_locally: true, enable_session_cache: false, fetch: options.fetchFunc }) }) })
  vm.runInContext(extract('function createPlayerRequestBody(') + '\n' + extract('function createEmbeddedVideoSession(') + '\n' + extract('async function createAndroidVrVideoSession('), ctx)
  const requests = []
  const fetch = async (request, init) => {
    requests.push({ url: request.url, headers: init.headers, body: init.body && JSON.parse(init.body), redirect: init.redirect })
    return new Response('{}', { status: 200 })
  }
  const web = await Session.create({ client_type: ClientType.WEB, retrieve_player: false, retrieve_innertube_config: false, generate_session_locally: true, enable_session_cache: false, fetch })
  web.context.client.visitorData = 'challenge-visitor'
  const embedded = ctx.createEmbeddedVideoSession(web, 'video-proof')
  assert.equal(embedded.logged_in, false)
  assert.equal(embedded.po_token, 'video-proof')
  assert.equal(web.context.client.clientName, 'WEB', 'Web session is not mutated')
  await embedded.actions.execute('/player', ctx.createPlayerRequestBody('video123456', 42, embedded.po_token))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.context.client.clientName, 'WEB_EMBEDDED_PLAYER')
  assert.equal(requests[0].body.context.client.visitorData, 'challenge-visitor')
  assert.equal(requests[0].headers.get('x-goog-visitor-id'), 'challenge-visitor')
  assert.equal(requests[0].body.serviceIntegrityDimensions.poToken, 'video-proof')
  assert.equal(requests[0].body.context.thirdParty.embedUrl, 'https://www.youtube.com/', 'youtubei.js must not override the actual embed URL')
  assert.equal(requests[0].headers.get('authorization'), null, 'TV OAuth never goes to the stream player')
  assert.equal(ctx.createEmbeddedVideoSession(web, ''), null)
  web.context.client.visitorData = ''
  assert.equal(ctx.createEmbeddedVideoSession(web, 'proof'), null)

  const vr = await ctx.createAndroidVrVideoSession('challenge-visitor', 'video-proof', fetch)
  await vr.actions.execute('/player', ctx.createPlayerRequestBody('video123456', 42, vr.po_token, 'ANDROID_VR'))
  assert.equal(requests[1].body.context.client.clientName, 'ANDROID_VR')
  assert.equal(requests[1].body.context.client.visitorData, 'challenge-visitor')
  assert.equal(requests[1].body.context.client.userAgent, Constants.CLIENTS.ANDROID_VR.USER_AGENT)
  assert.equal(requests[1].body.context.client.osName, 'Android')
  assert.equal(requests[1].headers.get('x-youtube-client-name'), '28')
  assert.equal(requests[1].headers.get('authorization'), null)
  assert.equal(requests[1].body.serviceIntegrityDimensions.poToken, 'video-proof')

  const tv = await Session.create({ client_type: ClientType.TV, retrieve_player: false, retrieve_innertube_config: false, generate_session_locally: true, enable_session_cache: false, fetch })
  await tv.signIn({ access_token: 'tv-bearer', refresh_token: 'refresh', expiry_date: '2099-01-01T00:00:00.000Z' })
  const trackerCode = fs.readFileSync('src/renderer/helpers/api/youtubeWatchTracker.js', 'utf8').replace('export function', 'function')
  const trackerCtx = vm.createContext({ URL })
  vm.runInContext(trackerCode, trackerCtx)
  let time = 100000
  const tracker = trackerCtx.createYouTubeWatchTracker({ session: tv, cpn: 'cpn', isActive: () => true, now: () => time, tracking: {
    videostatsPlaybackUrl: { baseUrl: 'https://s.youtube.com/api/stats/playback?video=video123456' },
    videostatsWatchtimeUrl: { baseUrl: 'https://s.youtube.com/api/stats/watchtime?video=video123456' }
  } })
  await tracker.update(1)
  time += 45000
  await tracker.update(5)
  assert.equal(requests.length, 4)
  for (const item of requests.slice(2)) {
    assert.equal(item.headers.get('authorization'), 'Bearer tv-bearer')
    assert.equal(new URL(item.url).searchParams.get('c'), 'tvhtml5')
    assert.equal(item.redirect, 'error')
  }
  assert.ok(requests[2].url.includes('/api/stats/playback'))
  assert.ok(requests[3].url.includes('/api/stats/watchtime'))
}

async function testSelection({ candidate, retryCandidate, signedIn = true, invalidated = false, parserError = false, missingVisitor = false, sameVisitor = false, retryFailure = false, retryEmpty = false, emptyInitial = false, stage = 0, vrCandidate = null, embeddedTracking = true, webTracking = true, webId = 'video123456' }) {
  const source = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
  const extract = start => {
    const a = source.indexOf(start), b = source.indexOf('\n/**', a)
    assert.ok(a >= 0 && b > a)
    return source.slice(a, b).replace('export async function', 'async function')
  }
  const events = [], requests = [], trackerArgs = []
  const tracking = { videostatsPlaybackUrl: { baseUrl: 'https://www.youtube.com/api/stats/playback' }, videostatsWatchtimeUrl: { baseUrl: 'https://www.youtube.com/api/stats/watchtime' } }
  const webContext = { client: { clientName: 'WEB', clientVersion: '1', visitorData: missingVisitor ? '' : 'original-visitor' } }
  const webPlayer = { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: webId }, streamingData: { formats: [{ id: 'web' }] }, ...(webTracking ? { playbackTracking: tracking } : {}) }
  const tv = { session: { logged_in: true, context: { client: { clientName: 'TVHTML5' } }, actions: { execute: async () => { events.push('tv-player'); throw Error('TV must never request /player') } } } }
  const streamResponse = (value) => value && !(value instanceof Error) && embeddedTracking ? { ...value, playbackTracking: tracking } : value
  let firstResponse, secondResponse, vrResponse
  class VideoInfo {
    constructor([player, next]) {
      if (parserError && player.data !== webPlayer) throw Error('bad embedded response')
      this.player = player.data
      this.next = next.data
      this.playability_status = { status: player.data.playabilityStatus.status }
      this.has_trailer = false
      this.getTrailerInfo = () => ({})
      this.basic_info = {}
      this.streaming_data = { formats: [], adaptive_formats: [] }
    }
  }
  let context
  const makeSession = (visitor, token) => ({
    context: { client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '2', visitorData: visitor } }, po_token: token,
    actions: { execute: async (path, body) => {
      events.push('embedded-player'); requests.push({ path, body, visitor, token })
      if (invalidated) vm.runInContext('accountSessionGeneration++', context)
      const answer = requests.length === 1 ? candidate : retryCandidate
      if (answer instanceof Error) throw answer
      const result = streamResponse(answer)
      if (requests.length === 1) firstResponse = result
      else secondResponse = result
      return { data: result }
    } }
  })
  context = vm.createContext({
    process: { env: { IS_ELECTRON: true } }, accountSessionGeneration: 0, accountInnertube: signedIn ? tv : null,
    getYouTubeAccountInnertube: async () => signedIn ? tv : null,
    getWatchHTMLWatchPage: async () => ({ session: { context: webContext, actions: { execute: async path => { throw Error(`unexpected web request ${path}`) } } }, playerResponse: webPlayer, nextResponse: { metadata: 'web' }, initialAttestationData: {}, ytConfig: {}, playerId: 'player' }),
    window: { ftElectron: { generatePoToken: async (_id, rawContext, _att, _config, force) => {
      const visitor = JSON.parse(rawContext).client.visitorData
      events.push(force ? 'retry-proof' : 'proof')
      if (!force) { assert.equal(visitor, webContext.client.visitorData); return emptyInitial ? '' : 'original-proof' }
      assert.equal(visitor, 'fresh-visitor')
      if (retryFailure) throw Error('retry failed')
      return retryEmpty ? '' : 'fresh-proof'
    } } },
    buildSessionFromYtConfig: config => ({ context: config.INNERTUBE_CONTEXT }),
    createAndroidVrVideoSession: async (visitor, token) => ({
      context: { client: { clientName: 'ANDROID_VR', clientVersion: '3', visitorData: visitor, osName: 'Android', osVersion: '12L' } },
      po_token: token, actions: { execute: async (path, body) => {
        events.push('vr-player')
        assert.equal(path, '/player')
        assert.equal(visitor, 'original-visitor')
        assert.equal(token, 'original-proof')
        assert.equal(body.client, 'ANDROID_VR')
        assert.equal(body.serviceIntegrityDimensions.poToken, token)
        if (vrCandidate instanceof Error) throw vrCandidate
        vrResponse = streamResponse(vrCandidate)
        return { data: vrResponse }
      } }
    }),
    createEmbeddedVideoSession: (session, token) => session.context.client.visitorData ? makeSession(session.context.client.visitorData, token) : null,
    Player: { create: async () => ({ signature_timestamp: 42, decipher: async url => url }) }, PlayerCache: class {}, UniversalCache: class {},
    YT: { VideoInfo }, Utils: { generateRandomString: () => 'cpn' }, ProtoUtils: { encodeVisitorData: () => sameVisitor ? 'original-visitor' : 'fresh-visitor' }, deepCopy: x => JSON.parse(JSON.stringify(x)),
    Constants: { CLIENT_NAME_IDS: { WEB: '1', WEB_EMBEDDED_PLAYER: '56', ANDROID_VR: '28' } },
    extractTotalAdTimeMilliseconds: () => 0, extractLocalContentDisclosures: () => null,
    createYouTubeWatchTracker: args => { trackerArgs.push(args); return args.tracking ? { update() {} } : null },
    decipherFormats: async () => {}, decipherManifestUrl: async url => url,
    createInnertube: async () => { throw Error('unexpected fallback') }, ClientType: {}, console: { warn() {}, error() {} }, Date,
  })
  vm.runInContext([extract('function createPlayerRequestBody('), extract('function createWatchNextRequestBody('), extract('export async function getLocalVideoInfo(')].join('\n'), context)
  const promise = context.getLocalVideoInfo('video123456', { playerFallbackStage: stage })
  if (emptyInitial) { await assert.rejects(promise, /empty proof token/); assert.equal(requests.length, 0); return }
  const result = await promise
  assert.ok(!events.includes('tv-player'), 'TV session is never used for stream extraction')
  assert.equal(result.info.next.metadata, 'web')
  const attempted = stage < 1 && !missingVisitor
  const retry = attempted && !sameVisitor && !retryFailure && !retryEmpty && ['UNPLAYABLE', 'LOGIN_REQUIRED'].includes(candidate?.playabilityStatus?.status)
  assert.equal(requests.length, attempted ? (retry ? 2 : 1) : 0)
  if (attempted) {
    assert.equal(requests[0].body.client, undefined, 'avoid youtubei.js overriding embedUrl')
    assert.equal(requests[0].body.serviceIntegrityDimensions.poToken, 'original-proof')
    assert.equal(requests[0].visitor, 'original-visitor')
  }
  if (retry) {
    assert.equal(requests[1].visitor, 'fresh-visitor')
    assert.equal(requests[1].body.serviceIntegrityDimensions.poToken, 'fresh-proof')
  }
  const embedResponse = retry ? secondResponse : firstResponse
  const playable = data => data?.playabilityStatus?.status === 'OK' && (!data.videoDetails?.videoId || data.videoDetails.videoId === 'video123456') && !!(data.streamingData?.formats?.length || data.streamingData?.adaptiveFormats?.length || data.streamingData?.hlsManifestUrl || data.streamingData?.dashManifestUrl || data.streamingData?.serverAbrStreamingUrl)
  const embedded = attempted && playable(embedResponse)
  const shouldTryVR = !embedded && stage < 2 && !missingVisitor
  assert.equal(events.includes('vr-player'), shouldTryVR)
  const vrSelected = shouldTryVR && playable(vrResponse)
  const chosen = embedded ? embedResponse : vrSelected ? vrResponse : webPlayer
  const preferred = (embedded || vrSelected) && !parserError
  assert.equal(result.info.player, preferred ? chosen : webPlayer)
  assert.equal(result.selectedPlayer, preferred ? (embedded ? 'embedded' : 'android-vr') : 'web')
  assert.equal(result.poToken, preferred && embedded && retry ? 'fresh-proof' : 'original-proof')
  assert.equal(result.clientInfo.clientName, preferred ? (embedded ? '56' : '28') : '1')
  assert.equal(trackerArgs.length, signedIn && !invalidated ? 1 : 0)
  if (trackerArgs.length) {
    assert.equal(trackerArgs[0].session, tv.session, 'TV session is used only for watch tracking')
    assert.equal(trackerArgs[0].isActive(), true)
    assert.equal(trackerArgs[0].tracking, preferred && embeddedTracking ? tracking : (webTracking && webId === 'video123456' ? tracking : undefined))
    vm.runInContext('accountSessionGeneration++', context)
    assert.equal(trackerArgs[0].isActive(), false, 'sign-out disables reporting')
  }
}

;(async () => {
  await testFreshChallenge()
  await testRealWire()
  const valid = { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'video123456' }, streamingData: { adaptiveFormats: [{}] } }
  const unplayable = { playabilityStatus: { status: 'UNPLAYABLE', reason: 'The page needs to be reloaded.' } }
  const login = { playabilityStatus: { status: 'LOGIN_REQUIRED' } }
  await testSelection({ candidate: valid })
  await testSelection({ candidate: valid, signedIn: false })
  await testSelection({ candidate: valid, invalidated: true })
  await testSelection({ candidate: valid, stage: 2 })
  await testSelection({ candidate: valid, stage: 1, vrCandidate: valid })
  await testSelection({ candidate: valid, missingVisitor: true })
  await testSelection({ candidate: valid, emptyInitial: true })
  await testSelection({ candidate: valid, parserError: true })
  await testSelection({ candidate: { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'wrong-video' }, streamingData: { formats: [{}] } } })
  await testSelection({ candidate: { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'video123456', isLive: true }, streamingData: { hlsManifestUrl: 'https://example.test/live' } } })
  await testSelection({ candidate: valid, embeddedTracking: false })
  await testSelection({ candidate: valid, embeddedTracking: false, webId: 'wrong-video' })
  const embedError = { playabilityStatus: { status: 'ERROR', errorCode: 'PLAYABILITY_ERROR_CODE_EMBEDDER_IDENTITY_DENIED' } }
  await testSelection({ candidate: { playabilityStatus: { status: 'OK' }, streamingData: {} }, vrCandidate: valid })
  await testSelection({ candidate: embedError, vrCandidate: valid })
  await testSelection({ candidate: embedError, vrCandidate: embedError })
  await testSelection({ candidate: embedError, vrCandidate: new Error('offline') })
  await testSelection({ candidate: unplayable, retryCandidate: unplayable, vrCandidate: valid })
  await testSelection({ candidate: unplayable, retryCandidate: valid })
  await testSelection({ candidate: login, retryCandidate: valid })
  await testSelection({ candidate: unplayable, retryCandidate: unplayable })
  await testSelection({ candidate: login, retryFailure: true })
  await testSelection({ candidate: login, retryEmpty: true })
  await testSelection({ candidate: login, sameVisitor: true })
  await testSelection({ candidate: new Error('offline') })
  console.log('Embedded, Android VR and TV watch reporting tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
