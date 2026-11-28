const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

async function testDashPlayer() {
  const { YT, Session, ClientType, Player, Platform } = await import('youtubei.js')
  const local = fs.readFileSync('src/renderer/helpers/api/local.js', 'utf8')
  assert.match(local, /htmlExtracts\.session\.player = player/)
  const session = await Session.create({ client_type: ClientType.WEB, retrieve_player: false, retrieve_innertube_config: false, generate_session_locally: true, enable_session_cache: false })
  const fmt = audio => ({ itag: audio ? 140 : 137, mimeType: audio ? 'audio/mp4; codecs="mp4a.40.2"' : 'video/mp4; codecs="avc1.4d401f"', bitrate: 1000, approxDurationMs: '120000', lastModified: '123456', initRange: { start: '0', end: '100' }, indexRange: { start: '101', end: '200' }, url: 'https://r1.googlevideo.com/videoplayback?n=raw&c=WEB', ...(audio ? { audioQuality: 'AUDIO_QUALITY_MEDIUM', audioSampleRate: '44100', audioChannels: 2 } : { qualityLabel: '1080p', width: 100, height: 100, fps: 30 }) })
  const { isDirectDashFormat, hasDirectDashPair } = require('../src/renderer/helpers/player/directDashRecovery.cjs')
  const info = new YT.VideoInfo([{ data: { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'abcdefghijk', title: 'test', lengthSeconds: '120', isLive: false }, streamingData: { expiresInSeconds: '100', adaptiveFormats: [fmt(true), fmt(false)] } } }, { data: {} }], session.actions, 'cpn')
  const originalEval = Platform.shim.eval
  let evaluations = 0
  const listeners = new Set()
  const parent = { addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) }
  const child = { parent: { postMessage: data => { for (const listener of [...listeners]) listener({ source: child, data }) } }, addEventListener: (_type, fn) => { child.listener = fn } }
  child.postMessage = data => { evaluations++; child.listener({ data }) }
  vm.runInNewContext(fs.readFileSync('src/renderer/sigFrameScript.js', 'utf8'), { window: child, URL, URLSearchParams })
  const begin = local.indexOf('if (process.env.SUPPORTS_LOCAL_API) {')
  const end = local.indexOf('\n/**', begin)
  vm.runInNewContext(local.slice(begin, end), { Platform, process: { env: { SUPPORTS_LOCAL_API: true, IS_ELECTRON: true } }, crypto: { randomUUID: () => String(Math.random()) }, document: { getElementById: () => ({ contentWindow: child }) }, window: parent })
  const fixture = `
    class MockUrl {
      constructor(url) { this.params = new URL(url).searchParams }
      transform() { this.params.set('n', this.params.get('n') + '-changed') }
      get(key) { return this.params.get(key) }
    }
    const exportedVars = { nsigFunction: url => new MockUrl(url) }
  `
  try {
    const player = new Player('fixture', 1, { output: fixture })
    player.po_token = 'test-proof'
    session.player = player
    assert.equal(hasDirectDashPair(info.streaming_data.adaptive_formats), true)
    assert.equal(hasDirectDashPair([{ has_audio: true, url: 'url' }, { has_video: true, url: 'url' }]), false, 'ranges are required')
    assert.equal(isDirectDashFormat({ url: 'url', is_type_otf: true, init_range: {}, index_range: {} }), false)
    const manifest = await info.toDash({ format_filter: format => !isDirectDashFormat(format) })
    assert.match(manifest, /n=raw-changed/)
    assert.match(manifest, /pot=test-proof/)
    assert.ok(evaluations > 0, 'real youtubei.js called configured evaluator')
    const sabr = new URL(await player.decipher('https://r1.googlevideo.com/videoplayback?sabr=1&n=raw'))
    assert.equal(sabr.searchParams.get('n'), 'raw-changed')
    assert.equal(sabr.searchParams.has('pot'), false, 'SABR uses token in POST payload instead')
  } finally { Platform.shim.eval = originalEval }
}

async function testRequestHandling() {
  const source = fs.readFileSync('src/renderer/helpers/player/SabrSchemePlugin.js', 'utf8')
  const from = source.indexOf('async function doRequest(')
  const to = source.indexOf('/**\n * @param {import(\'../../views/Watch/Watch\').SabrData}', from)
  assert.ok(from >= 0 && to > from)
  class ErrorStub extends Error {
    static Severity = { RECOVERABLE: 1, CRITICAL: 2 }
    static Category = { NETWORK: 1 }
    static Code = { OPERATION_ABORTED: 7001, TIMEOUT: 1003, HTTP_ERROR: 1002, BAD_HTTP_STATUS: 1001 }
    constructor(severity, category, code, ...data) { super('Shaka'); Object.assign(this, { severity, category, code, data }) }
  }
  const partIds = { NEXT_REQUEST_POLICY: 1, STREAM_PROTECTION_STATUS: 2, SABR_ERROR: 3, SABR_REDIRECT: 4, MEDIA_HEADER: 5, MEDIA: 6, MEDIA_END: 7 }
  let parts = [], requests = 0, reloads = 0, status = 200, switchToMedia = false
  const context = vm.createContext({
    URL, Uint8Array, Error, ShakaError: ErrorStub, UMPPartId: partIds,
    StreamProtectionStatus: {}, SabrError: {}, SabrRedirect: {}, NextRequestPolicy: {}, MediaHeader: {},
    concatenateChunks: chunks => Uint8Array.from(chunks.flatMap(chunk => [...chunk])),
    decodePart: data => data, formatIdFromString: () => ({ itag: 1, lastModified: '1' }),
    prepareSabrContexts: () => ({ sabrContexts: [], unsentSabrContexts: [] }),
    VideoPlaybackAbrRequest: { encode: () => ({ finish: () => new Uint8Array() }) },
    createRecoverableNetworkError: (code, ...data) => new ErrorStub(1, 1, code, ...data),
    UmpReader: class { constructor(options) { this.options = options } async feed() { const selected = switchToMedia && requests > 1 ? [[5, { formatId: { itag: 1, lastModified: '1' }, segmentNum: 12, headerId: 7 }], [6, { getUint8: () => 7, split: () => ({ remainingBuffer: { chunks: [Uint8Array.from([2, 3])] } }) }], [7, { getUint8: () => 7 }]] : parts; for (const [id, data] of selected) this.options.onPart(id, data) } },
    fetch: async () => { requests++; let read = false; return { ok: status === 200, status, body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: new Uint8Array() }) }) } } },
    setTimeout: fn => { queueMicrotask(fn); return 1 }, clearTimeout: () => {}, console: { warn() {} }
  })
  vm.runInContext(source.slice(from, to), context)
  const fresh = () => ({ initDataCache: new Map(), abrRequest: { streamerContext: {} }, requestInit: {}, abortStatus: {}, abortController: new AbortController(), sabrStreamState: { sabrUrl: 'https://r1.googlevideo.com/videoplayback', activeSabrContextTypes: new Set(), sabrContexts: new Map(), requestNumber: 0 }, eventEmitter: { emit: type => { if (type === 'reload') reloads++ } }, retryCount: 0 })
  const op = { uri: 'sabr:audio?formatId=1', formatIdString: '1', request: { retryParameters: { timeout: 30000 } }, requestType: 1, headersReceived() {} }
  status = 403; requests = 0; parts = [[1, {}]]
  await assert.rejects(context.doRequest(op, fresh()), err => err.code === 1001 && err.data[1] === 403 && err.severity === 2)
  assert.equal(requests, 1, '403 is propagated without retry or parsing')
  status = 200; requests = 0; parts = [[1, {}], [2, { status: 3 }]]
  await assert.rejects(context.doRequest(op, fresh()), err => err.code === 1002 && err.data[1].message === 'Invalid PO token')
  assert.equal(requests, 1, 'invalid token is not hidden by retry policy')
  requests = 0; reloads = 0; parts = [[1, {}]]
  await assert.rejects(context.doRequest(op, fresh()), err => err.code === 7001)
  assert.equal(requests, 8, 'bounded policy-only retries'); assert.equal(reloads, 1)
  requests = 0; switchToMedia = true; parts = [[1, {}]]
  const result = await context.doRequest({ ...op, sequenceNumber: 12 }, fresh())
  assert.equal(requests, 2); assert.deepEqual([...result.data], [2, 3], 'a normal segment can complete after a policy retry')
  switchToMedia = false
  requests = 0; reloads = 0; parts = [[4, { url: 'https://r2.googlevideo.com/videoplayback' }]]
  await assert.rejects(context.doRequest(op, fresh()), err => err.code === 7001)
  assert.equal(requests, 8, 'redirect retries are bounded too'); assert.equal(reloads, 1)
}

async function testWatchRecovery() {
  const source = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
  const start = source.indexOf('    async onSabrReloadRequested() {')
  const end = source.indexOf('    ...mapActions([', start)
  const toasts = [], calls = []
  const fn = vm.runInNewContext(`({${source.slice(start, end)}})`, { console: { warn() {} }, showToast: text => toasts.push(text) }).onSabrReloadRequested
  let paused = true
  const view = { videoId: 'abcdefghijk', $route: { params: { id: 'abcdefghijk' } }, $refs: { player: { hasLoaded: true, isPaused: () => paused } }, getTimestamp: () => 59, reloadView: async (...args) => calls.push(args) }
  await fn.call(view); assert.equal(view.sabrRecoveryDeferred, true); assert.equal(calls.length, 0)
  paused = false
  await fn.call(view); await fn.call(view); await fn.call(view)
  assert.deepEqual(calls, [[0, 59], [0, 59]]); assert.equal(toasts.length, 1)
  assert.equal(view.sabrResumeVideoId, view.videoId)
  assert.match(source, /currentSeconds >= this\.sabrRecoveryPosition \+ 60/)
  assert.match(source, /this\.sabrData && this\.videoPlayerLoaded && !this\.isReloadingView/)
  const errStart = source.indexOf('    handlePlayerError: function (error) {')
  const errEnd = source.indexOf('    handleActiveFormatUnavailable:', errStart)
  const errorHandler = vm.runInNewContext(`({${source.slice(errStart, errEnd)}})`, { shaka: { util: { Error: { Code: { HTTP_ERROR: 1002, BAD_HTTP_STATUS: 1001, VIDEO_ERROR: 3016 } } } }, navigator: { onLine: true }, console: { warn() {} } }).handlePlayerError
  let triggered = 0
  const host = { sabrData: {}, videoPlayerLoaded: true, isReloadingView: false, sabrRecoveryPending: false, videoId: 'new', sabrRecoveryVideoId: 'old', sabrRecoveryAttempts: 2, handleWatchProgressAutoSaveWhenProgressEnabled() {}, onSabrReloadRequested() { triggered++ } }
  errorHandler.call(host, { code: 1001, data: ['ignored', 403] })
  assert.equal(triggered, 1, 'new video can recover even when previous video exhausted its budget')
  host.sabrRecoveryVideoId = 'new'; host.sabrRecoveryAttempts = 2; host.streamingDataExpiryDate = new Date(Date.now() + 10000); host.videoGenreIsMusic = false
  errorHandler.call(host, { code: 1001, data: ['ignored', 403] })
  assert.equal(triggered, 1); assert.match(host.errorMessage, /403/, 'repeated 403 ends with the real error')
}
Promise.resolve().then(testDashPlayer).then(testRequestHandling).then(testWatchRecovery).then(() => console.log('DASH deciphering, SABR retries and reload limits passed')).catch(error => { console.error(error); process.exitCode = 1 })
