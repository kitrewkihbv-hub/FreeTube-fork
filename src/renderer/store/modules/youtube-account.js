import {
  clearYouTubeAccountSession,
  getYouTubeAccountActivityFeed,
  getYouTubeAccountHistory,
  getYouTubeAccountInfo,
  getYouTubeAccountPlaylists,
  getYouTubeAccountSubscriptions,
  setYouTubeAccountSubscription,
} from '../../helpers/api/local'

/**
 * @typedef {object} YouTubeAccountState
 * @property {boolean} signedIn
 * @property {string|null} name
 * @property {string|null} channelId
 * @property {string|null} thumbnail
 * @property {string|null} handle
 */

let feedRequest = null
let feedGeneration = 0

const state = {
  /** @type {YouTubeAccountState} */
  youtubeAccount: {
    signedIn: false,
    name: null,
    channelId: null,
    thumbnail: null,
    handle: null
  },
  /** @type {{ userCode: string, verificationUrl: string, expiresIn: number } | null} */
  youtubeAccountSignInPrompt: null,
  youtubeAccountSigningIn: false,
  youtubeAccountRestored: false,
  youtubeAccountBusy: false,
  /** @type {object[]|null} */
  youtubeAccountFeed: null,
  youtubeAccountFeedInfo: null
}

const getters = {
  /**
   * @param {object} state
   * @returns {YouTubeAccountState}
   */
  getYouTubeAccount(state) {
    return state.youtubeAccount
  },

  /**
   * @param {object} state
   * @returns {boolean}
   */
  getIsSignedInToYouTubeAccount(state) {
    return state.youtubeAccount.signedIn
  },

  /**
   * @param {object} state
   * @returns {{ userCode: string, verificationUrl: string, expiresIn: number } | null}
   */
  getYouTubeAccountSignInPrompt(state) {
    return state.youtubeAccountSignInPrompt
  },

  /**
   * @param {object} state
   * @returns {boolean}
   */
  getIsSigningInToYouTubeAccount(state) {
    return state.youtubeAccountSigningIn
  },

  /**
   * Whether the stored account state has been read (so that the UI can tell the
   * difference between "signed out" and "still loading")
   * @param {object} state
   * @returns {boolean}
   */
  getYouTubeAccountRestored(state) {
    return state.youtubeAccountRestored
  },

  /**
   * @param {object} state
   * @returns {boolean}
   */
  getYouTubeAccountBusy(state) {
    return state.youtubeAccountBusy
  },

  /**
   * @param {object} state
   * @returns {object[]|null}
   */
  getYouTubeAccountFeed(state) {
    return state.youtubeAccountFeed
  },

  getYouTubeAccountFeedInfo(state) {
    return state.youtubeAccountFeedInfo
  }
}

const mutations = {
  /**
   * @param {object} state
   * @param {Partial<YouTubeAccountState>} account
   */
  setYouTubeAccount(state, account) {
    state.youtubeAccount = {
      ...state.youtubeAccount,
      ...account
    }
  },

  /**
   * @param {object} state
   */
  clearYouTubeAccount(state) {
    state.youtubeAccount = {
      signedIn: false,
      name: null,
      channelId: null,
      thumbnail: null,
      handle: null
    }
    state.youtubeAccountSignInPrompt = null
    state.youtubeAccountSigningIn = false
    state.youtubeAccountFeed = null
    state.youtubeAccountFeedInfo = null
    feedGeneration++
    feedRequest = null
  },

  /**
   * @param {object} state
   * @param {{ userCode: string, verificationUrl: string, expiresIn: number } | null} prompt
   */
  setYouTubeAccountSignInPrompt(state, prompt) {
    state.youtubeAccountSignInPrompt = prompt
  },

  /**
   * @param {object} state
   * @param {boolean} signingIn
   */
  setYouTubeAccountSigningIn(state, signingIn) {
    state.youtubeAccountSigningIn = signingIn
  },

  /**
   * @param {object} state
   * @param {boolean} restored
   */
  setYouTubeAccountRestored(state, restored) {
    state.youtubeAccountRestored = restored
  },

  /**
   * @param {object} state
   * @param {boolean} busy
   */
  setYouTubeAccountBusy(state, busy) {
    state.youtubeAccountBusy = busy
  },

  /**
   * @param {object} state
   * @param {object[]|null} feed
   */
  setYouTubeAccountFeed(state, feed) {
    state.youtubeAccountFeed = feed
  },

  setYouTubeAccountFeedInfo(state, info) {
    state.youtubeAccountFeedInfo = info
  }
}

/**
 * Converts the account state that the main process keeps to the shape used in the store
 * @param {object} accountState
 */
function toAccount(accountState) {
  return {
    signedIn: !!accountState?.isSignedIn,
    name: accountState?.name ?? null,
    channelId: accountState?.channelId ?? null,
    thumbnail: accountState?.thumbnail ?? null,
    handle: accountState?.handle ?? null
  }
}

const actions = {
  /**
   * Loads the account details that were stored during the previous sessions
   * and refreshes them from YouTube if there is a signed in account.
   */
  async grabYouTubeAccount({ commit, dispatch }) {
    if (!process.env.IS_ELECTRON) {
      commit('setYouTubeAccountRestored', true)
      return
    }

    try {
      const accountState = await window.ftElectron.getAccountState()

      commit('setYouTubeAccount', toAccount(accountState))

      if (accountState.isSignedIn) {
        await dispatch('refreshYouTubeAccountInfo')
      }
    } catch (error) {
      console.error('failed to load the YouTube account', error)
    } finally {
      commit('setYouTubeAccountRestored', true)
    }
  },

  async refreshYouTubeAccountInfo({ commit }) {
    try {
      const accountInfo = await getYouTubeAccountInfo()

      if (!accountInfo.signedIn) {
        commit('clearYouTubeAccount')
        return
      }

      commit('setYouTubeAccount', accountInfo)
    } catch (error) {
      console.error('failed to refresh the YouTube account details', error)
    }
  },

  /**
   * Starts the OAuth2 device flow and shows the prompt with the code for the user.
   */
  async signInToYouTubeAccount({ commit, dispatch }) {
    if (!process.env.IS_ELECTRON) {
      return
    }

    commit('setYouTubeAccountSigningIn', true)

    try {
      const signInPrompt = await window.ftElectron.signInToYouTubeAccount()

      commit('setYouTubeAccountSignInPrompt', {
        userCode: signInPrompt.user_code,
        verificationUrl: signInPrompt.verification_url,
        expiresIn: signInPrompt.expires_in
      })
    } catch (error) {
      console.error('failed to sign in to the YouTube account', error)
      commit('setYouTubeAccountSigningIn', false)
      commit('setYouTubeAccountSignInPrompt', null)
      throw error
    }
  },

  /**
   * This is called by the listener that the main process triggers when the authorization is complete
   */
  async handleYouTubeAccountSignInSuccess({ commit, dispatch }) {
    clearYouTubeAccountSession()

    commit('setYouTubeAccountSignInPrompt', null)
    commit('setYouTubeAccountSigningIn', false)
    commit('setYouTubeAccountRestored', true)

    await dispatch('refreshYouTubeAccountInfo')
  },

  cancelYouTubeAccountSignIn({ commit }) {
    if (!process.env.IS_ELECTRON) {
      return
    }

    window.ftElectron.cancelYouTubeAccountSignIn()

    commit('setYouTubeAccountSignInPrompt', null)
    commit('setYouTubeAccountSigningIn', false)
  },

  async signOutOfYouTubeAccount({ commit }) {
    if (!process.env.IS_ELECTRON) {
      return
    }

    try {
      await window.ftElectron.signOutOfYouTubeAccount()
    } catch (error) {
      console.error('failed to sign out of the YouTube account', error)
    }

    clearYouTubeAccountSession()
    commit('clearYouTubeAccount')
  },

  handleYouTubeAccountSignInError({ commit }) {
    commit('setYouTubeAccountSignInPrompt', null)
    commit('setYouTubeAccountSigningIn', false)
  },

  /**
   * Imports the YouTube subscriptions into the given profiles
   * @param {object} context the Vuex action context
   * @param {object} payload
   * @param {string[]} payload.profileIds the profiles to add the channels to
   * @returns {Promise<{ channelCount: number, addedCount: number, partial: boolean }>}
   */
  async importYouTubeAccountSubscriptions(context, { profileIds }) {
    const { commit, dispatch, rootState } = context

    commit('setYouTubeAccountBusy', true)

    try {
      const { channels, partial } = await getYouTubeAccountSubscriptions()

      let addedCount = 0

      for (const profileId of profileIds) {
        const profile = rootState.profiles.profileList.find(profile => profile._id === profileId)

        if (profile === undefined) {
          continue
        }

        const existingChannels = new Set(profile.subscriptions.map(channel => channel.id))

        const newChannels = channels.filter(channel => !existingChannels.has(channel.id))

        for (const channel of newChannels) {
          await dispatch('addChannelToProfiles', { channel, profileIds: [profileId] }, { root: true })
        }

        addedCount = Math.max(addedCount, newChannels.length)
      }

      return { channelCount: channels.length, addedCount, partial }
    } finally {
      commit('setYouTubeAccountBusy', false)
    }
  },

  /**
   * Same as `importYouTubeAccountSubscriptions`, but for the profile that is currently active.
   * This is what the "Sync Subscriptions to the Active Profile" setting uses.
   * @param {object} context the Vuex action context
   * @param {object} payload
   * @param {string} [payload.profileId]
   */
  syncSubscriptionsFromYouTubeAccount(context, { profileId } = {}) {
    const activeProfileId = profileId ?? context.rootGetters.getActiveProfile._id

    return context.dispatch('importYouTubeAccountSubscriptions', {
      profileIds: [activeProfileId]
    })
  },

  /**
   * Subscribes on YouTube to every channel that is in the given profile,
   * so that the two subscription lists can be made identical.
   * @param {object} context the Vuex action context
   * @param {object} payload
   * @param {string} [payload.profileId]
   * @returns {Promise<number>} the number of channels that were subscribed to
   */
  async importProfileSubscriptionsToYouTubeAccount(context, { profileId } = {}) {
    const { commit, rootGetters } = context

    const profile = profileId === undefined
      ? rootGetters.getActiveProfile
      : context.rootState.profiles.profileList.find(profile => profile._id === profileId)

    if (profile === undefined) {
      return 0
    }

    commit('setYouTubeAccountBusy', true)

    try {
      const existingChannels = new Set(
        (await getYouTubeAccountSubscriptions()).channels.map(channel => channel.id)
      )

      const newChannels = profile.subscriptions.filter(channel => !existingChannels.has(channel.id))

      for (const channel of newChannels) {
        await setYouTubeAccountSubscription(channel.id, true)
      }

      return newChannels.length
    } finally {
      commit('setYouTubeAccountBusy', false)
    }
  },

  /**
   * Subscribes to or unsubscribes from a channel on YouTube with the signed in account
   * @param {object} context
   * @param {Function} context.dispatch
   * @param {object} payload
   * @param {string} payload.channelId
   * @param {boolean} payload.subscribed
   */
  async setYouTubeAccountSubscription({ dispatch }, { channelId, subscribed }) {
    try {
      await setYouTubeAccountSubscription(channelId, subscribed)
      await dispatch('clearYouTubeAccountFeed')
    } catch (error) {
      console.error('failed to change the subscription on YouTube', error)
      throw error
    }
  },

  /**
   * Explicitly imports recent YouTube watch history into FreeTube's local history.
   * This is separate from automatic local watch tracking and never uploads or deletes
   * local history.
   * @param {object} context the Vuex action context
   * @param {Function} context.commit
   * @param {Function} context.dispatch
   * @returns {Promise<{ addedCount: number, updatedCount: number, fetchedCount: number, truncated: boolean }>}
   */
  async syncYouTubeAccountHistory({ commit, dispatch }) {
    commit('setYouTubeAccountBusy', true)

    try {
      // Avoid racing the initial history preload, which could otherwise overwrite the
      // imported records in the Vuex cache after the database merge has completed.
      await dispatch('grabHistory', null, { root: true })

      const accountData = await getYouTubeAccountHistory()
      const mergeResult = await dispatch('mergeYouTubeAccountHistory', accountData.history, { root: true })

      return {
        ...mergeResult,
        fetchedCount: accountData.history.length,
        truncated: accountData.truncated
      }
    } finally {
      commit('setYouTubeAccountBusy', false)
    }
  },

  /**
   * Imports the signed-in account's custom playlists, Watch Later, and Liked videos.
   * Existing FreeTube playlists are merged additively and are never deleted or uploaded.
   * @param {object} context the Vuex action context
   * @param {Function} context.commit
   * @param {Function} context.dispatch
   * @param {object} context.rootGetters
   * @returns {Promise<{ playlistCount: number, newPlaylistCount: number, videoCount: number, truncated: boolean, failedPlaylistCount: number }>}
   */
  async syncYouTubeAccountPlaylists({ commit, dispatch, rootGetters }) {
    commit('setYouTubeAccountBusy', true)

    try {
      // Account sync can start during app launch, so ensure the local playlist list has
      // finished loading before merging; otherwise this import could overwrite or miss
      // existing FreeTube playlists.
      if (!rootGetters.getPlaylistsReady) {
        await dispatch('grabAllPlaylists', null, { root: true })
      }

      if (!rootGetters.getPlaylistsReady) {
        throw new Error('FreeTube local playlists are not ready to sync.')
      }

      const accountData = await getYouTubeAccountPlaylists()
      const mergeResult = await dispatch('mergeYouTubeAccountPlaylists', accountData.playlists, { root: true })

      return {
        ...mergeResult,
        truncated: accountData.truncated,
        failedPlaylistCount: accountData.failedPlaylistCount
      }
    } finally {
      commit('setYouTubeAccountBusy', false)
    }
  },

  /**
   * Replaces the local subscriptions feed with the one from the signed in YouTube account
   * @param {object} context the Vuex action context
   * @param {object} payload
   * @param {boolean} [payload.refresh]
   */
  async grabYouTubeAccountFeed(context, { refresh = false } = {}) {
    const { commit } = context

    if (context.state.youtubeAccountFeed !== null && !refresh) {
      return context.state.youtubeAccountFeed
    }

    if (feedRequest) return feedRequest

    const generation = feedGeneration
    const request = (async () => {
      const result = await getYouTubeAccountActivityFeed()
      if (generation === feedGeneration) {
        commit('setYouTubeAccountFeed', result.videos)
        commit('setYouTubeAccountFeedInfo', { ...result, fetchedAt: Date.now() })
      }
      return result.videos
    })()
    feedRequest = request
    try {
      return await request
    } finally {
      if (feedRequest === request) feedRequest = null
    }
  },

  clearYouTubeAccountFeed({ commit }) {
    feedGeneration++
    feedRequest = null
    commit('setYouTubeAccountFeedInfo', null)
    commit('setYouTubeAccountFeed', null)
  }
}

export default {
  state,
  getters,
  mutations,
  actions
}
