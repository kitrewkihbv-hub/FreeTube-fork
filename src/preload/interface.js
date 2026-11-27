import { ipcRenderer, webFrame } from 'electron/renderer'
import { IpcChannels } from '../constants.js'

/**
 * Linux fix for dynamically updating theme preference, this works on
 * all systems running the electron app.
 */
ipcRenderer.on(IpcChannels.NATIVE_THEME_UPDATE, (_, shouldUseDarkColors) => {
  document.body.dataset.systemTheme = shouldUseDarkColors ? 'dark' : 'light'
})

let currentUpdateSearchInputTextListener

export default {
  /** @param {boolean} active */
  setLocalMusicActive: (active) => ipcRenderer.send(IpcChannels.LOCAL_MUSIC_ACTIVE, active),
  /** @param {{title: string, artist: string, playing: boolean, shuffle: boolean, videoId: string, durationMs: number, progressMs: number}|null} state */
  updateLocalPlayerState: (state) => ipcRenderer.send(IpcChannels.LOCAL_PLAYER_STATE, state),
  /** @param {(command: string | {type: string, positionMs: number}) => void} callback */
  onLocalPlayerCommand: (callback) => {
    const listener = (_, command) => callback(command)
    ipcRenderer.on(IpcChannels.LOCAL_PLAYER_COMMAND, listener)
    return () => ipcRenderer.removeListener(IpcChannels.LOCAL_PLAYER_COMMAND, listener)
  },

  /** @param {(command: string | {type: string, positionMs: number}) => void} callback */
  onSpotifyPlayerCommand: (callback) => {
    const listener = (_, command) => callback(command)
    ipcRenderer.on(IpcChannels.SPOTIFY_PLAYER_COMMAND, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SPOTIFY_PLAYER_COMMAND, listener)
  },

  /** @param {(command: string) => void} callback */
  onDynamicIslandCommand: (callback) => {
    const listener = (_, command) => callback(command)
    ipcRenderer.on(IpcChannels.DYNAMIC_ISLAND_COMMAND, listener)
    return () => ipcRenderer.removeListener(IpcChannels.DYNAMIC_ISLAND_COMMAND, listener)
  },

  /**
   * @returns {Promise<string>}
   */
  getSystemLocale: () => {
    return ipcRenderer.invoke(IpcChannels.GET_SYSTEM_LOCALE)
  },

  /**
   * @returns {Promise<boolean>}
   */
  isWaylandPlatform: () => {
    return ipcRenderer.invoke(IpcChannels.IS_WAYLAND_PLATFORM)
  },

  /**
   * @param {string} path
   * @param {Record<string, string> | null | undefined} query
   * @param {string | null | undefined} searchQueryText
   */
  openInNewWindow: (path, query, searchQueryText) => {
    ipcRenderer.send(IpcChannels.CREATE_NEW_WINDOW, path, query, searchQueryText)
  },

  /**
   * @param {string} url
   */
  enableProxy: (url) => {
    ipcRenderer.send(IpcChannels.ENABLE_PROXY, url)
  },

  disableProxy: () => {
    ipcRenderer.send(IpcChannels.DISABLE_PROXY)
  },

  /**
   * @param {string} authorization
   * @param {string} url
   */
  setInvidiousAuthorization: (authorization, url) => {
    ipcRenderer.send(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, authorization, url)
  },

  clearInvidiousAuthorization: () => {
    ipcRenderer.send(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, null)
  },

  startPowerSaveBlocker: () => {
    ipcRenderer.send(IpcChannels.START_POWER_SAVE_BLOCKER)
  },

  stopPowerSaveBlocker: () => {
    ipcRenderer.send(IpcChannels.STOP_POWER_SAVE_BLOCKER)
  },

  /**
   * @returns {Promise<boolean>}
   */
  getReplaceHttpCache: () => {
    return ipcRenderer.invoke(IpcChannels.GET_REPLACE_HTTP_CACHE)
  },

  /**
   * @returns {Promise<boolean>}
   */
  getDisableHardwareAcceleration: () => {
    return ipcRenderer.invoke(IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION)
  },

  toggleReplaceHttpCache: () => {
    ipcRenderer.send(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE)
  },

  toggleDisableHardwareAcceleration: () => {
    ipcRenderer.send(IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION)
  },

  // Allows programmatic toggling of picture-in-picture mode without accompanying user interaction.
  // See: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation#transient_activation
  requestPiP: () => {
    webFrame.executeJavaScript('document.querySelector("video.player")?.ui.getControls().togglePiP()', true).catch()
  },

  // Allows programmatic toggling of fullscreen without accompanying user interaction.
  // See: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation#transient_activation
  requestFullscreen: () => {
    webFrame.executeJavaScript('document.querySelector("video.player")?.ui.getControls().toggleFullScreen()', true).catch()
  },

  /**
   * @param {string} key
   * @returns {Promise<ArrayBuffer>}
   */
  playerCacheGet: (key) => {
    return ipcRenderer.invoke(IpcChannels.PLAYER_CACHE_GET, key)
  },

  /**
   * @param {string} key
   * @param {ArrayBuffer} value
   */
  playerCacheSet: async (key, value) => {
    await ipcRenderer.invoke(IpcChannels.PLAYER_CACHE_SET, key, value)
  },

  /**
   * @param {string} videoId
   * @param {string} context
   * @param {string} initialAttestationData
   * @param {string} ytConfig
   * @param {boolean} [forceNewChallenge]
   * @returns {Promise<string>}
   */
  generatePoToken: (videoId, context, initialAttestationData, ytConfig, forceNewChallenge = false) => {
    return ipcRenderer.invoke(IpcChannels.GENERATE_PO_TOKEN, videoId, context, initialAttestationData, ytConfig, forceNewChallenge)
  },

  /**
   * @returns {Promise<import('../main/youtubeAccount').AccountState>}
   */
  getAccountState: () => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_GET_STATE)
  },

  /**
   * @returns {Promise<import('../main/youtubeAccount').AccountTokens | null>}
   */
  getAccountTokens: () => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_GET_TOKENS)
  },

  /** @param {string|null} rejectedToken */
  ensureValidYouTubeAuth: (rejectedToken = null) => ipcRenderer.invoke(IpcChannels.ACCOUNT_ENSURE_AUTH, rejectedToken),

  /** @param {string} rejectedToken */
  rejectYouTubeAccountToken: (rejectedToken) => ipcRenderer.invoke(IpcChannels.ACCOUNT_REJECT_TOKEN, rejectedToken),

  /**
   * @param {import('../main/youtubeAccount').AccountTokens} tokens
   * @param {string|undefined} expectedAccessToken
   */
  updateAccountTokens: (tokens, expectedAccessToken) => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_UPDATE_TOKENS, tokens, expectedAccessToken)
  },

  /**
   * @returns {Promise<{ user_code: string, verification_url: string, expires_in: number }>}
   */
  signInToYouTubeAccount: () => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_SIGN_IN)
  },

  cancelYouTubeAccountSignIn: () => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_CANCEL_SIGN_IN)
  },

  /**
   * @returns {Promise<import('../main/youtubeAccount').AccountState>}
   */
  signOutOfYouTubeAccount: () => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_SIGN_OUT)
  },

  /**
   * @param {Partial<import('../main/youtubeAccount').AccountState>} accountInfo
   * @returns {Promise<import('../main/youtubeAccount').AccountState>}
   */
  updateYouTubeAccountInfo: (accountInfo) => {
    return ipcRenderer.invoke(IpcChannels.ACCOUNT_UPDATE, accountInfo)
  },

  /**
   * @param {(accountState: import('../main/youtubeAccount').AccountState) => void} handler
   */
  handleYouTubeAccountSignInSuccess: (handler) => {
    ipcRenderer.on(IpcChannels.ACCOUNT_SIGN_IN_SUCCESS, (_, accountState) => {
      handler(accountState)
    })
  },

  /**
   * @param {(errorMessage: string) => void} handler
   */
  handleYouTubeAccountSignInError: (handler) => {
    ipcRenderer.on(IpcChannels.ACCOUNT_SIGN_IN_ERROR, (_, errorMessage) => {
      handler(errorMessage)
    })
  },

  chooseDefaultFolder: () => {
    ipcRenderer.send(IpcChannels.CHOOSE_DEFAULT_FOLDER)
  },

  /**
   * @param {string} filename
   * @param {ArrayBuffer} contents
   * @returns {Promise<boolean>}
   */
  writeToDefaultFolder: async (filename, contents) => {
    return await ipcRenderer.invoke(IpcChannels.WRITE_TO_DEFAULT_FOLDER, filename, contents)
  },

  relaunch: () => {
    ipcRenderer.send(IpcChannels.RELAUNCH_REQUEST)
  },

  /**
   * @param {import('../main/externalPlayer').ExternalPlayerPayload} payload
   */
  openInExternalPlayer: (payload) => {
    // require the user to have interacted with the page recently
    if (navigator.userActivation.isActive) {
      ipcRenderer.send(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, payload)
    }
  },

  /**
   * @param {(
   *   externalPlayer: string,
   *   unsuportedActions: (import('../constants').UnsupportedPlayerAction)[],
   *   isPlaylist: boolean
   * ) => void} handler
   */
  handleOpenInExternalPlayerResult: (handler) => {
    ipcRenderer.on(IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT,
      (event, externalPlayer, unsupportedActions, isPlaylist) => {
        handler(externalPlayer, unsupportedActions, isPlaylist)
      })
  },

  /**
   * @param {number} factor
   */
  setZoomFactor: (factor) => {
    if (typeof factor === 'number' && factor > 0) {
      webFrame.setZoomFactor(factor)
    }
  },

  /**
   * @returns {Promise<{ label: string, value: number, active: boolean }[]>}
   */
  getNavigationHistory: () => {
    return ipcRenderer.invoke(IpcChannels.GET_NAVIGATION_HISTORY)
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSettings: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_SETTINGS, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbHistory: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_HISTORY, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbProfiles: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_PROFILES, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbPlaylists: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_PLAYLISTS, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSearchHistory: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_SEARCH_HISTORY, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSubscriptionCache: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_SUBSCRIPTION_CACHE, data ? { action, data } : { action })
  },

  /**
   * @param {(route: string) => void} handler
   */
  handleChangeView: (handler) => {
    ipcRenderer.on(IpcChannels.CHANGE_VIEW, (_, route) => {
      handler(route)
    })
  },

  /**
   * @param {(url: string) => void} handler
   */
  handleOpenUrl: (handler) => {
    ipcRenderer.on(IpcChannels.OPEN_URL, (_, url) => {
      handler(url)
    })
    ipcRenderer.send(IpcChannels.APP_READY)
  },

  /**
   * Pass `null` to clear the handler
   * @param {(text: string) => void | null} handler
   */
  handleUpdateSearchInputText: (handler) => {
    if (currentUpdateSearchInputTextListener) {
      ipcRenderer.off(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, currentUpdateSearchInputTextListener)
      currentUpdateSearchInputTextListener = undefined
    }

    if (handler) {
      currentUpdateSearchInputTextListener = (_, text) => {
        handler(text)
      }

      ipcRenderer.on(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, currentUpdateSearchInputTextListener)
      ipcRenderer.send(IpcChannels.SEARCH_INPUT_HANDLING_READY)
    }
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncSettings: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_SETTINGS, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncHistory: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_HISTORY, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncSearchHistory: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_SEARCH_HISTORY, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncProfiles: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_PROFILES, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncPlaylists: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_PLAYLISTS, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncSubscriptionCache: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_SUBSCRIPTION_CACHE, (_, { event, data }) => {
      handler(event, data)
    })
  }
}
