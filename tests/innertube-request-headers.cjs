const assert = require('node:assert/strict')
const { configureInnertubeHeaders, ANDROID_VR_USER_AGENT } = require('../src/main/innertubeRequestHeaders.cjs')

;(async () => {
  const { Constants } = await import('youtubei.js')
  assert.equal(ANDROID_VR_USER_AGENT, Constants.CLIENTS.ANDROID_VR.USER_AGENT, 'VR HTTP UA must match the pinned youtubei.js client')
  const embedded = { referer: 'file://wrong', origin: 'null', 'x-youtube-client-name': '56', 'user-agent': 'browser' }
  configureInnertubeHeaders(embedded, 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false')
  assert.equal(embedded.Referer, 'https://www.youtube.com/')
  assert.equal(embedded.Origin, 'https://www.youtube.com')
  assert.equal(embedded.referer, undefined)
  assert.equal(embedded.origin, undefined)
  assert.equal(embedded['user-agent'], 'browser')
  assert.equal(embedded['X-Youtube-Bootstrap-Logged-In'], 'false')
  const vr = { 'X-YouTube-Client-Name': '28', 'user-agent': 'browser', Authorization: 'Bearer sample' }
  configureInnertubeHeaders(vr, 'https://www.youtube.com/youtubei/v1/player?alt=json')
  assert.equal(vr['User-Agent'], ANDROID_VR_USER_AGENT)
  assert.equal(vr['user-agent'], undefined)
  assert.equal(vr.Authorization, 'Bearer sample')
  assert.equal(vr['X-Youtube-Bootstrap-Logged-In'], 'true')
  const browse = { 'X-YouTube-Client-Name': '28', 'User-Agent': 'browser' }
  configureInnertubeHeaders(browse, 'https://www.youtube.com/youtubei/v1/browse')
  assert.equal(browse['User-Agent'], 'browser', 'the VR UA is scoped only to the player endpoint')
  const main = require('node:fs').readFileSync('src/main/index.js', 'utf8')
  assert.match(main, /if \(url\.startsWith\('https:\/\/www\.youtube\.com\/youtubei\/'\)\)\s*\{[\s\S]*?configureInnertubeHeaders\(requestHeaders, url\)/)
  console.log('YouTube request header tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
