const { TV_EMBEDDED_USER_AGENT } = require('../youtubePlayerClients.cjs')

// Keep this in sync with youtubei.js's ANDROID_VR client. Renderer fetch cannot
// reliably set User-Agent, so Electron sets it only on the VR player request.
const ANDROID_VR_USER_AGENT = 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip'

function configureInnertubeHeaders(requestHeaders, url) {
  const findHeader = name => Object.entries(requestHeaders).find(([key]) => key.toLowerCase() === name)?.[1]
  const setHeader = (name, value) => {
    for (const key of Object.keys(requestHeaders)) {
      if (key.toLowerCase() === name.toLowerCase()) delete requestHeaders[key]
    }
    requestHeaders[name] = value
  }
  const authorization = findHeader('authorization')
  const clientName = findHeader('x-youtube-client-name')
  setHeader('Referer', 'https://www.youtube.com/')
  setHeader('Origin', 'https://www.youtube.com')
  setHeader('Sec-Fetch-Site', 'same-origin')
  setHeader('Sec-Fetch-Mode', 'same-origin')
  setHeader('X-Youtube-Bootstrap-Logged-In', /^Bearer\s/i.test(authorization ?? '') ? 'true' : 'false')
  // Do not rewrite UA for account, history or any other InnerTube endpoint.
  if (new URL(url).pathname === '/youtubei/v1/player') {
    if (clientName === '28') setHeader('User-Agent', ANDROID_VR_USER_AGENT)
    if (clientName === '85' && /^Bearer\s/i.test(authorization ?? '')) setHeader('User-Agent', TV_EMBEDDED_USER_AGENT)
  }
  return requestHeaders
}

module.exports = { configureInnertubeHeaders, ANDROID_VR_USER_AGENT }
