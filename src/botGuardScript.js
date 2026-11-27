import { BotGuardClient } from 'bgutils-js/botguard'
import { buildURL, GOOG_API_KEY } from 'bgutils-js/utils'
import { WebPoMinter } from 'bgutils-js/webpo'

// This script has it's own webpack config, as it gets passed as a string to Electron's evaluateJavaScript function
// in src/main/poTokenGenerator.js

/**
 * Based on: https://github.com/LuanRT/BgUtils/blob/main/examples/node/innertube-challenge-fetcher-example.ts
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @param {boolean} forceNewChallenge
 */
export default async function (videoId, context, initialAttestationData, ytConfig, forceNewChallenge = false) {
  const requestKey = 'O43z0dpjhgX20SCx4KAo'

  let challengeData = initialAttestationData.R

  if (!challengeData?.bgChallenge && !forceNewChallenge) {
    throw new Error('Failed to get BotGuard challenge')
  }

  let interpreterUrl = challengeData?.bgChallenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue

  // A locally regenerated visitor ID needs an attestation request with that
  // exact visitor in both the header and body, not the old embedded challenge.
  if (!interpreterUrl || forceNewChallenge) {
    const challengeResponse = await fetch(
      'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false&alt=json',
      {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
          'X-Goog-Visitor-Id': context.client.visitorData,
          'X-Youtube-Client-Version': context.client.clientVersion,
          'X-Youtube-Client-Name': '1'
        },
        body: JSON.stringify({
          engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
          eacrToken: initialAttestationData.T,
          context
        }),
      }
    )

    if (!challengeResponse.ok) {
      throw new Error(`BotGuard challenge request failed with status ${challengeResponse.status}`)
    }

    challengeData = await challengeResponse.json()

    if (!challengeData.bgChallenge) {
      throw new Error('Failed to get BotGuard challenge')
    }

    interpreterUrl = challengeData.bgChallenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  }

  if (typeof interpreterUrl !== 'string' || !interpreterUrl) throw new Error('BotGuard interpreter URL missing')

  if (interpreterUrl.startsWith('//')) {
    interpreterUrl = `https:${interpreterUrl}`
  }

  const bgScriptResponse = await fetch(interpreterUrl)
  if (!bgScriptResponse.ok) throw new Error(`BotGuard interpreter request failed with status ${bgScriptResponse.status}`)
  const interpreterJavascript = await bgScriptResponse.text()

  if (interpreterJavascript) {
    window.yt = { config_: ytConfig } // BotGuard reads the EVENT_ID field
    // eslint-disable-next-line no-new-func
    new Function(interpreterJavascript)()
  } else {
    throw new Error('Could not load VM.')
  }

  const botGuard = await BotGuardClient.create({
    program: challengeData.bgChallenge.program,
    globalName: challengeData.bgChallenge.globalName,
    globalObject: window
  })

  const webPoSignalOutput = []
  const botGuardResponse = await botGuard.snapshot({ webPoSignalOutput }, 10_000)

  const integrityTokenResponse = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify([requestKey, botGuardResponse])
  })

  if (!integrityTokenResponse.ok) throw new Error(`BotGuard integrity request failed with status ${integrityTokenResponse.status}`)
  const response = await integrityTokenResponse.json()

  if (typeof response[0] !== 'string') {
    throw new Error('Could not get integrity token')
  }

  const integrityTokenBasedMinter = await WebPoMinter.create({ integrityToken: response[0] }, webPoSignalOutput)

  const token = await integrityTokenBasedMinter.mintAsWebsafeString(videoId)
  if (typeof token !== 'string' || !token) throw new Error('BotGuard returned an empty proof token')
  return token
}
