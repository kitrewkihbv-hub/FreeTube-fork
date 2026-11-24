import { app, safeStorage } from 'electron'
import { existsSync } from 'fs'
import path from 'path'
import asyncFs from 'fs/promises'

/**
 * Signing in to a Google / YouTube account is done with the OAuth2 device flow
 * that the YouTube TV app uses, the same flow SmartTube and other third party clients use.
 *
 * The refresh token is a long lived credential, so it never leaves the main process
 * unless the renderer explicitly asks for it (which it needs to make authenticated
 * InnerTube requests). It is encrypted at rest with the OS keychain (via Electron's
 * safeStorage) whenever that is available.
 */

const ACCOUNT_STATE_FILE_NAME = 'youtube-account.json'

const OAUTH_URLS = {
  code: 'https://www.youtube.com/o/oauth2/device/code',
  token: 'https://www.youtube.com/o/oauth2/token',
  revoke: 'https://www.youtube.com/o/oauth2/revoke'
}

// The scope used by the YouTube TV app (which is what the OAuth client ID below belongs to)
const OAUTH_SCOPE = 'http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content'

const TV_SCRIPT_REGEX = /<script\s+id="base-js"\s+src="([^"]+)"[^>]*><\/script>/
const CLIENT_IDENTITY_REGEX = /clientId:"(?<client_id>[^"]+)",[^"]*?:"(?<client_secret>[^"]+)"/

/**
 * @typedef {object} AccountTokens
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {string} expiry_date ISO timestamp of when the access token expires
 * @property {string} [scope]
 * @property {string} [token_type]
 * @property {{ client_id: string, client_secret: string }} [client]
 */

/**
 * @typedef {object} AccountState
 * @property {boolean} isSignedIn
 * @property {string|null} name display name of the account / channel
 * @property {string|null} channelId
 * @property {string|null} thumbnail
 * @property {string|null} handle
 * @property {string|null} email
 * @property {AccountTokens|null} tokens
 */

/** @returns {AccountState} */
function getSignedOutAccountState() {
  return {
    isSignedIn: false,
    name: null,
    channelId: null,
    thumbnail: null,
    handle: null,
    email: null,
    tokens: null
  }
}

/** @type {AccountState} */
let accountState = getSignedOutAccountState()

/** @type {string|null} */
let accountStateFilePath = null

/** @type {Promise<void>|null} */
let accountStateLoadPromise = null

/** @type {AbortController|null} */
let pendingSignInController = null

// Serialize writes so a late account-info update cannot overwrite newer credentials.
let accountStateWrite = Promise.resolve()

/**
 * @param {string} userDataPath
 */
export function initYoutubeAccount(userDataPath) {
  accountStateFilePath = path.join(userDataPath, ACCOUNT_STATE_FILE_NAME)
}

/**
 * @returns {AccountState}
 */
export function getAccountState() {
  return accountState
}

/**
 * Waits until the state has been read from the disk before returning it,
 * so that requests made during the startup do not report a signed out account.
 * @returns {Promise<AccountState>}
 */
export async function getLoadedAccountState() {
  if (accountStateLoadPromise !== null) {
    await accountStateLoadPromise
  }

  return accountState
}

/**
 * Returns the tokens in a form that is safe to send over IPC
 * @returns {AccountTokens|null}
 */
export function getAccountTokens() {
  return accountState.isSignedIn ? accountState.tokens : null
}

/**
 * This is called by the renderer to keep the account details (name, avatar, etc.)
 * in sync after it retrieves them from YouTube.
 * @param {Partial<AccountState>} accountInfo
 */
export function updateAccountInfo(accountInfo) {
  if (!accountState.isSignedIn) {
    return getAccountState()
  }

  for (const key of ['name', 'channelId', 'thumbnail', 'handle', 'email']) {
    if (typeof accountInfo[key] === 'string' || accountInfo[key] === null) {
      accountState[key] = accountInfo[key]
    }
  }

  saveAccountState().catch(error => console.error('youtube account: failed to save account details', error))

  return accountState
}

/**
 * Loads the account state from the disk (and decrypts it if it was encrypted)
 */
export function loadAccountState() {
  // safeStorage is not usable until Electron is ready (notably on macOS).
  accountStateLoadPromise = app.whenReady().then(() => readAccountState())

  return accountStateLoadPromise
}

async function readAccountState() {
  if (!accountStateFilePath || !existsSync(accountStateFilePath)) {
    return
  }

  try {
    const rawFile = await asyncFs.readFile(accountStateFilePath, 'utf8')
    const storedState = JSON.parse(rawFile)

    let serializedState = storedState.data

    if (storedState.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('youtube account: the OS keychain is not available, the account tokens cannot be decrypted')
        return accountState
      }

      serializedState = safeStorage.decryptString(Buffer.from(storedState.data, 'base64'))
    }

    const parsedState = JSON.parse(serializedState)

    if (parsedState?.tokens?.refresh_token) {
      accountState = {
        isSignedIn: true,
        name: parsedState.name ?? null,
        channelId: parsedState.channelId ?? null,
        thumbnail: parsedState.thumbnail ?? null,
        handle: parsedState.handle ?? null,
        email: parsedState.email ?? null,
        tokens: parsedState.tokens
      }
    }
  } catch (error) {
    console.error('youtube account: failed to load the account state', error)

    accountState = getSignedOutAccountState()
  }
}

/**
 * Persists the current account state, encrypting the tokens when possible
 */
function saveAccountState() {
  if (!accountStateFilePath) {
    return Promise.reject(new Error('The YouTube account storage path is not available.'))
  }

  const filePath = accountStateFilePath
  const serializedState = JSON.stringify(accountState)
  const operation = accountStateWrite.catch(() => {}).then(async () => {
    let fileContents
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(serializedState)
      fileContents = JSON.stringify({ encrypted: true, data: encrypted.toString('base64') })
    } else {
      console.warn('youtube account: the OS keychain is not available, the account tokens are stored unencrypted')
      fileContents = JSON.stringify({ encrypted: false, data: serializedState })
    }

    await asyncFs.mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    try {
      await asyncFs.writeFile(temporaryPath, fileContents, { encoding: 'utf8', mode: 0o600 })
      await asyncFs.rename(temporaryPath, filePath)
    } catch (error) {
      await asyncFs.rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
  })
  accountStateWrite = operation
  return operation
}

/**
 * Saves tokens that were refreshed by the renderer so that they survive a restart
 * @param {AccountTokens} tokens
 */
export async function updateAccountTokens(tokens) {
  if (!accountState.isSignedIn || !tokens?.access_token || !tokens?.refresh_token) {
    return
  }

  accountState.tokens = tokens

  await saveAccountState()
}

/**
 * Retrieves the OAuth client ID and secret of the YouTube TV app
 * @returns {Promise<{ client_id: string, client_secret: string }>}
 */
async function getOAuthClientID() {
  const tvResponse = await fetch('https://www.youtube.com/tv', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
      Referer: 'https://www.youtube.com/tv',
      'Accept-Language': 'en-US'
    }
  })

  if (!tvResponse.ok) {
    throw new Error(`Could not load the YouTube TV page (${tvResponse.status})`)
  }

  const tvPage = await tvResponse.text()

  const scriptUrl = TV_SCRIPT_REGEX.exec(tvPage)?.[1]

  if (!scriptUrl) {
    throw new Error('Could not find the YouTube TV script URL')
  }

  const scriptResponse = await fetch(new URL(scriptUrl, 'https://www.youtube.com'))

  if (!scriptResponse.ok) {
    throw new Error(`Could not load the YouTube TV script (${scriptResponse.status})`)
  }

  const script = await scriptResponse.text()

  const clientIdentity = CLIENT_IDENTITY_REGEX.exec(script)?.groups

  if (!clientIdentity?.client_id || !clientIdentity?.client_secret) {
    throw new Error('Could not find the OAuth client identity')
  }

  return {
    client_id: clientIdentity.client_id,
    client_secret: clientIdentity.client_secret
  }
}

/**
 * @param {{ client_id: string, client_secret: string }} client
 * @returns {Promise<{ device_code: string, user_code: string, verification_url: string, expires_in: number, interval: number }>}
 */
async function getDeviceAndUserCode(client) {
  const response = await fetch(OAUTH_URLS.code, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: client.client_id,
      scope: OAUTH_SCOPE,
      device_id: crypto.randomUUID(),
      device_model: 'ytlr::'
    })
  })

  if (!response.ok) {
    throw new Error(`Could not start the sign in flow (${response.status})`)
  }

  const data = await response.json()

  if (data.error || data.error_code) {
    throw new Error(data.error_description ?? data.error ?? data.error_code)
  }

  return data
}

/**
 * @param {{ client_id: string, client_secret: string }} client
 * @param {string} deviceCode
 * @returns {Promise<AccountTokens>}
 */
async function pollForAccessToken(client, deviceCode) {
  const response = await fetch(OAUTH_URLS.token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code: deviceCode,
      grant_type: 'http://oauth.net/grant_type/device/1.0'
    })
  })

  const data = await response.json()

  if (data.error || data.error_code) {
    const error = new Error(data.error_description ?? data.error ?? data.error_code)
    error.code = data.error ?? data.error_code
    throw error
  }

  return {
    ...data,
    expiry_date: new Date(Date.now() + (data.expires_in * 1000)).toISOString(),
    client
  }
}

/**
 * @param {number} milliseconds
 * @param {AbortSignal} signal
 * @returns {Promise<void>} rejects when the signal is aborted
 */
function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }

    const onAbort = () => {
      clearTimeout(timeout)
      reject(new Error('aborted'))
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * @param {{ client_id: string, client_secret: string }} client
 * @param {string} deviceCode
 * @param {AbortSignal} signal
 * @param {number} interval seconds between the access token requests
 * @returns {Promise<AccountTokens>}
 */
async function waitForAuthorization(client, deviceCode, signal, interval) {
  // the device codes are usually valid for 30 minutes
  const timeoutTimestamp = Date.now() + (30 * 60 * 1000)

  while (Date.now() < timeoutTimestamp) {
    await wait(interval * 1000, signal)

    try {
      return await pollForAccessToken(client, deviceCode)
    } catch (error) {
      if (error.code === 'authorization_pending') {
        continue
      }

      if (error.code === 'slow_down') {
        // the server wants us to wait a bit longer between the requests
        interval += 5
        continue
      }

      if (error.code === 'expired_token') {
        throw new Error('The sign in code has expired, please try again.', { cause: error })
      }

      if (error.code === 'access_denied') {
        throw new Error('The sign in request was denied.', { cause: error })
      }

      throw error
    }
  }

  throw new Error('The sign in code has expired, please try again.')
}

/**
 * Starts the OAuth2 device flow.
 *
 * Resolves with the device code and user code that the UI shows to the user,
 * while the authorization polling happens in the background. The result of the
 * polling is sent to the renderer through the `onUpdate` callback.
 *
 * @param {(accountState: AccountState) => void} onUpdate called when the sign in succeeds
 * @param {(errorMessage: string) => void} onError called when the sign in fails
 * @returns {Promise<{ user_code: string, verification_url: string, expires_in: number }>}
 */
export async function startSignIn(onUpdate, onError) {
  await cancelSignIn()

  const controller = new AbortController()
  pendingSignInController = controller

  try {
    const client = await getOAuthClientID()
    const deviceAndUserCode = await getDeviceAndUserCode(client)

    waitForAuthorization(client, deviceAndUserCode.device_code, controller.signal, deviceAndUserCode.interval)
      .then(async (tokens) => {
        if (controller.signal.aborted || pendingSignInController !== controller) return
        accountState = {
          isSignedIn: true,
          name: null,
          channelId: null,
          thumbnail: null,
          handle: null,
          email: null,
          tokens
        }

        try {
          await saveAccountState()
        } catch (error) {
          accountState = getSignedOutAccountState()
          throw new Error('Could not save your sign-in on this device. Please check the app data folder permissions.', { cause: error })
        }

        if (controller.signal.aborted || pendingSignInController !== controller) return
        pendingSignInController = null
        onUpdate(accountState)
      })
      .catch((error) => {
        if (pendingSignInController === controller) pendingSignInController = null
        if (error.message !== 'aborted' && !controller.signal.aborted) {
          console.error('youtube account: sign in failed', error)
          onError(error.message)
        }
      })

    return {
      user_code: deviceAndUserCode.user_code,
      verification_url: deviceAndUserCode.verification_url,
      expires_in: deviceAndUserCode.expires_in
    }
  } catch (error) {
    pendingSignInController = null
    throw error
  }
}

/**
 * Stops an in progress sign in attempt
 */
export async function cancelSignIn() {
  if (pendingSignInController !== null) {
    pendingSignInController.abort()
    pendingSignInController = null
  }
}

/**
 * Revokes the tokens and removes the stored account
 */
export async function signOut() {
  await cancelSignIn()

  const tokens = accountState.tokens

  accountState = getSignedOutAccountState()

  // Wait for already queued saves before deleting so they cannot resurrect the account.
  await accountStateWrite.catch(() => {})
  if (accountStateFilePath) {
    await asyncFs.rm(accountStateFilePath, { force: true })
  }

  if (tokens?.access_token) {
    // best effort, the tokens are already removed locally
    try {
      await fetch(`${OAUTH_URLS.revoke}?token=${encodeURIComponent(tokens.access_token)}`, { method: 'POST' })
    } catch (error) {
      console.error('youtube account: failed to revoke the access token', error)
    }
  }

  return accountState
}
