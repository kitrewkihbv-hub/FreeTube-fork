import { ClientType, Constants, Innertube, Misc, Mixins, Parser, Platform, Player, Session, UniversalCache, Utils, YT, YTNodes } from 'youtubei.js'
import Autolinker from 'autolinker'
import { parseLooseJSON } from 'bgutils-js/utils'

import { SEARCH_CHAR_LIMIT } from '../../../constants'
import { PlayerCache } from './PlayerCache'
import {
  CHANNEL_HANDLE_REGEX,
  calculatePublishedDate,
  deepCopy,
  escapeHTML,
  extractNumberFromString,
  getChannelPlaylistId,
  getRelativeTimeFromDate,
} from '../utils'
import { parseVideoClipsParams } from './shared'
import {
  createYouTubeAccountRawFeed,
  getYouTubeAccountRawItem,
  getYouTubeAccountRawText,
} from './youtubeAccountRawFeed'
import { getYouTubeAccountSubscriptionTabs } from './youtubeAccountSubscriptions'
import { loadAccountActivity } from './youtubeAccountActivity'
import { hasLiveBadge } from './discoveryFeed'

const TRACKING_PARAM_NAMES = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]
const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:']
const SCHEMELESS_DOMAIN_URL_PATTERN = /^(?:\/\/)?[^./?#:@\s]+(?:\.[^./?#:@\s]+)+(?::\d+)?(?:[/?#]|$)/
const YOUTUBE_REDIRECT_HOSTS = ['youtube.com', 'www.youtube.com']

/**
 * @param {URL} url
 * @returns {string|null|undefined} The q value, null when missing, or undefined for a non-redirect URL.
 */
function getYouTubeRedirectTarget(url) {
  if (!YOUTUBE_REDIRECT_HOSTS.includes(url.hostname) || url.pathname !== '/redirect') {
    return undefined
  }

  return url.searchParams.get('q')
}

if (process.env.SUPPORTS_LOCAL_API) {
  Platform.shim.eval = (data) => {
    return new Promise((resolve, reject) => {
      const code = data.output

      // Generate a unique ID, as there may be multiple eval calls going on at the same time (e.g. DASH manifest generation)
      const messageId = process.env.IS_ELECTRON || crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 10000)}`

      if (process.env.IS_ELECTRON) {
        const iframe = document.getElementById('sigFrame')

        /** @param {MessageEvent} event */
        const listener = (event) => {
          if (event.source === iframe.contentWindow && typeof event.data === 'string') {
            const data = JSON.parse(event.data)

            if (data.id === messageId) {
              window.removeEventListener('message', listener)

              if (data.error) {
                reject(data.error)
              } else {
                resolve(data.result)
              }
            }
          }
        }

        window.addEventListener('message', listener)
        iframe.contentWindow.postMessage(JSON.stringify({ id: messageId, code }), '*')
      } else {
        reject(new Error('Please setup the eval function for the n/sig deciphering'))
      }
    })
  }
}

/**
 * @param {object} options
 * @param {boolean} options.withPlayer set to true to get an instance that can decode the streaming URLs
 * @param {string|undefined} options.location the geolocation to pass to YouTube get different content
 * @param {boolean} options.safetyMode whether to hide mature content
 * @param {import('youtubei.js').ClientType} options.clientType use an alterate client
 * @param {boolean} options.generateSessionLocally generate the session locally or let YouTube generate it (local is faster, remote is more accurate)
 * @param {?import('youtubei.js').Types.FetchFunction} options.fetchFunc optional custom fetch function
 * @param {string} options.userAgent the user agent to use for the requests
 */
async function createSession({
  withPlayer = false,
  location = undefined,
  safetyMode = false,
  clientType = undefined,
  generateSessionLocally = true,
  fetchFunc = null,
  userAgent = navigator.userAgent,
} = {}) {
  let cache
  if (withPlayer) {
    if (process.env.IS_ELECTRON) {
      cache = new PlayerCache()
    } else {
      cache = new UniversalCache(false)
    }
  }

  return await Session.create({
    // This setting is enabled by default and results in YouTube.js reusing the same session across different Session instances.
    // That behavior is highly undesirable for FreeTube, as we want to create a new session every time to limit tracking.
    enable_session_cache: false,
    retrieve_innertube_config: !generateSessionLocally,
    user_agent: userAgent,

    retrieve_player: !!withPlayer,
    location: location,
    enable_safety_mode: !!safetyMode,
    client_type: clientType,

    // use browser fetch
    fetch: (fetchFunc ?? ((input, init) => fetch(input, init))),
    cache,
    generate_session_locally: !!generateSessionLocally
  })
}

/**
 * @param {Parameters<createSession>[0]} [options={}]
 * @see {@linkcode createSession} for the description of the various options
 */
async function createInnertube(options = {}) {
  const session = await createSession(options)
  return new Innertube(session)
}

/** @type {Innertube | null} */
let searchSuggestionsSession = null

export async function getLocalSearchSuggestions(query) {
  // The search suggestions endpoint does not like search queries larger than SEARCH_CHAR_LIMIT
  // so return an empty array instead
  if (query.length > SEARCH_CHAR_LIMIT) {
    return []
  }

  // reuse innertube instance to keep the search suggestions snappy
  if (searchSuggestionsSession === null) {
    searchSuggestionsSession = await createInnertube()
  }

  return await searchSuggestionsSession.getSearchSuggestions(query)
}

export function clearLocalSearchSuggestionsSession() {
  searchSuggestionsSession = null
}

export async function getLocalPlaylist(id) {
  const innertube = await createInnertube()
  return await innertube.getPlaylist(id)
}

/**
 * @typedef {object} SerializedContinuation
 * @property {import('youtubei.js').Context} context
 * @property {string} path
 * @property {any} payload
 */

/**
 * @param {import('youtubei.js').YTNodes.ContinuationItem | import('youtubei.js').YTNodes.ContinuationItemView} continuationItemOrView
 * @param {import('youtubei.js').Actions} actions
 */
function serializeContinuation(continuationItemOrView, actions) {
  let path, payload

  // Based on YouTube.js' NavigationEndpoint#call()
  if (continuationItemOrView.endpoint.command.is(YTNodes.CommandExecutorCommand)) {
    /** @type {import('youtubei.js').Helpers.YTNode & import('youtubei.js').APIResponseTypes.IEndpoint} */
    const command = continuationItemOrView.endpoint.command.commands.at(-1)

    path = command.getApiPath()
    payload = command.buildRequest()
  } else {
    path = continuationItemOrView.endpoint.metadata.api_url
    payload = continuationItemOrView.endpoint.payload
  }

  /** @type {SerializedContinuation} */
  const data = {
    path,
    payload: payload,
    context: actions.session.context
  }

  return JSON.stringify(data)
}

/**
 * @template {import('youtubei.js').YTNodes} N
 * @param {import('youtubei.js').Mixins.Feed} feed
 * @param {import('youtubei.js').YTNodeConstructor<N>[]} types
 * @return {N}
 */
function extractFeedContinuation(feed, types) {
  let continuationItem

  if (feed.page.header_memo) {
    const headerContinuations = feed.page.header_memo.getType(...types)
    continuationItem = feed.memo.getType(...types).find(
      (continuation) => !headerContinuations.includes(continuation)
    )
  } else {
    continuationItem = feed.memo.getType(types)[0]
  }

  if (!continuationItem) {
    throw new Utils.InnertubeError('There are no continuations.')
  }

  return continuationItem
}

/**
 * Based on YouTube.js' YT.Playlist.getContinuationData method
 * @param {import('youtubei.js').YT.Playlist} playlist
 */
export function extractLocalCacheablePlaylistContinuation(playlist) {
  const sectionList = playlist.memo.getType(YTNodes.SectionList)[0]

  let continuationItemOrView

  // No section list means there can't be additional continuation nodes here,
  // so no need to check.
  if (!sectionList) {
    continuationItemOrView = extractFeedContinuation(playlist, [YTNodes.ContinuationItem, YTNodes.ContinuationItemView])
  } else {
    continuationItemOrView = playlist.memo.getType(YTNodes.ContinuationItem, YTNodes.ContinuationItemView)
      .find((node) => !sectionList.contents.includes(node))
  }

  if (!continuationItemOrView) {
    throw new Utils.InnertubeError('There are no continuations.')
  }

  return serializeContinuation(continuationItemOrView, playlist.actions)
}

/**
 * Based on YouTube.js' YT.Search.getContinuationData method
 * @param {import('youtubei.js').YT.Search} search
 * @returns {SerializedContinuation}
 */
export function extractLocalCacheableSearchContinuation(search) {
  const continuationItem = extractFeedContinuation(search, [YTNodes.ContinuationItem])

  return serializeContinuation(continuationItem, search.actions)
}

/**
 * @overload
 * @param {'playlist'} type
 * @param {string} continuation
 * @returns {Promise<import('youtubei.js').YT.Playlist>}
 */

/**
 * @overload
 * @param {'search'} type
 * @param {string} continuation
 * @returns {Promise<import('youtubei.js').YT.Search>}
 */

/**
 * @param {'playlist' | 'search'} type
 * @param {string} continuation
 */
export async function getLocalCachedFeedContinuation(type, continuation) {
  /** @type {SerializedContinuation} */
  const data = JSON.parse(continuation)

  const session = await createSession()
  session.context = data.context

  const page = await session.actions.execute(data.path, { ...data.payload, parse: true })

  if (!page) {
    throw new Utils.InnertubeError('Could not get continuation data')
  }

  if (type === 'playlist') {
    return new YT.Playlist(session.actions, page, true)
  } else {
    return new YT.Search(session.actions, page, true)
  }
}

/**
 * @param {import('youtubei.js').YT.Playlist} playlist
 * @returns {Promise<import('youtubei.js').YT.Playlist|null>} null when no valid playlist can be found (e.g. `empty continuation response`)
 */
export async function getLocalPlaylistContinuation(playlist) {
  try {
    return await playlist.getContinuation()
  } catch (error) {
    // Youtube can provide useless continuation data
    if (!error.message.includes('Got empty continuation response.')) {
      // Re-throw unhandled error
      throw error
    }

    return null
  }
}

/**
 * Callback for processing a Local playlist.
 *
 * @callback untilEndOfLocalPlayListCallback
 * @param {import('youtubei.js').YT.Playlist} playlist
 */

/**
 * @param {import('youtubei.js').YT.Playlist} playlist
 * @param {untilEndOfLocalPlayListCallback} callback
 * @param {object} options
 * @param {boolean} options.runCallbackOnceFirst
 */
export async function untilEndOfLocalPlayList(playlist, callback, options = { runCallbackOnceFirst: true }) {
  if (options.runCallbackOnceFirst) { callback(playlist) }

  while (playlist != null && playlist.has_continuation) {
    playlist = await getLocalPlaylistContinuation(playlist)

    if (playlist != null) { callback(playlist) }
  }
}

/**
 * @param {string} location
 * @param {'gaming' | 'sports' | 'podcasts'} tab
 */
export async function getLocalTrending(location, tab) {
  const session = await createSession({ location })

  let args

  switch (tab) {
    case 'gaming':
      // https://www.youtube.com/gaming/trending
      args = {
        browseId: 'UCOpNcN46UbXVtpKMrmU4Abg',
        params: 'Egh0cmVuZGluZ7gBAJIDAPIGBAoCMgA'
      }
      break
    case 'sports':
      // https://www.youtube.com/channel/UCEgdi0XIXXZ-qJOFPf4JSKw/sportstab?ss=CMMG
      args = {
        browseId: 'UCEgdi0XIXXZ-qJOFPf4JSKw',
        params: 'EglzcG9ydHN0YWK4AQCSAwDyBgQKAjIA'
      }
      break
    case 'podcasts':
      // https://www.youtube.com/podcasts/popularepisodes
      args = {
        browseId: 'FEpodcasts_destination',
        params: 'qgcCCAM%3D'
      }
      break
    default:
      throw new Error('Unknown trending tab')
  }

  const response = await session.actions.execute('/browse', args)
  const feed = new Mixins.Feed(session.actions, response)

  return feed.videos.map(video => parseLocalListVideo(video)).filter(_ => _)
}

// #region YouTube account
//
// Signing in with a Google / YouTube account uses the same OAuth2 device flow
// as the YouTube TV app (the tokens are stored by the Electron main process).

/**
 * @typedef {object} YouTubeAccountTokens
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {string} expiry_date
 * @property {string} [scope]
 * @property {string} [token_type]
 * @property {{ client_id: string, client_secret: string }} [client]
 */

/** Maximum number of pages read from the subscribed-channels list */
const CHANNELS_FEED_PAGES_TO_FETCH = 100

/** Maximum number of recent YouTube watch-history pages fetched per sync */
const YOUTUBE_ACCOUNT_HISTORY_PAGES_TO_FETCH = 20

/** Maximum number of YouTube playlist index pages fetched per sync */
const YOUTUBE_ACCOUNT_PLAYLIST_INDEX_PAGES_TO_FETCH = 20

/** Maximum number of custom YouTube playlists imported per sync */
const YOUTUBE_ACCOUNT_PLAYLISTS_TO_FETCH = 50

/** Maximum total playlist-content pages fetched per sync */
const YOUTUBE_ACCOUNT_PLAYLIST_CONTENT_PAGES_TO_FETCH = 100

/** Leave one initial page each for YouTube Watch Later and Liked videos */
const YOUTUBE_ACCOUNT_SYSTEM_PLAYLIST_CONTENT_PAGE_RESERVE = 2

/** The user agent of the YouTube TV app, which is the client that the account tokens belong to */
const TV_CLIENT_USER_AGENT = 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version'

/** @type {YouTubeAccountTokens | null} */
let accountTokens = null

/** @type {Innertube | null} */
let accountInnertube = null

/** @type {Innertube | null} */
let accountWebInnertube = null

/** @type {Promise<Innertube> | null} */
let accountWebInnertubePromise = null

/**
 * The account tokens are periodically refreshed by YouTube,
 * so we need to make sure that the main process has the newest ones.
 * @param {YouTubeAccountTokens} tokens
 */
function saveAccountTokens(tokens) {
  accountTokens = tokens

  if (process.env.IS_ELECTRON) {
    window.ftElectron.updateAccountTokens(tokens)
  }
}

/**
 * @returns {Promise<YouTubeAccountTokens | null>}
 */
async function getAccountTokens() {
  if (!process.env.IS_ELECTRON) {
    return null
  }

  if (accountTokens === null) {
    accountTokens = await window.ftElectron.getAccountTokens()
  }

  return accountTokens
}

/**
 * Removes the in-memory account data, so that the next request starts fresh
 */
export function clearYouTubeAccountSession() {
  accountTokens = null
  accountInnertube = null
  accountWebInnertube = null
  accountWebInnertubePromise = null
}

/**
 * Returns an Innertube instance that is signed in to the YouTube account.
 *
 * The instance is created with the TV client, which is the client that the OAuth2
 * tokens belong to. It is reused so that the access token is only refreshed when needed.
 *
 * @returns {Promise<Innertube|null>} null when not signed in
 */
export async function getYouTubeAccountInnertube() {
  const tokens = await getAccountTokens()

  if (tokens === null) {
    return null
  }

  if (accountInnertube === null) {
    // Do not cache the client until OAuth sign-in succeeds. Caching it first leaves a
    // failed, unauthenticated client in place, which can make later account reads look
    // like a successful empty result instead of reporting the auth error.
    const innertube = await createInnertube({
      clientType: ClientType.TV,
      // the TVInnerTube API expects requests from the TV app
      userAgent: TV_CLIENT_USER_AGENT
    })

    innertube.session.on('update-credentials', ({ credentials }) => {
      saveAccountTokens({ ...accountTokens, ...credentials })
    })

    await innertube.session.signIn(tokens)

    if (!innertube.session.logged_in) {
      throw new Error('YouTube did not authenticate the saved account tokens.')
    }

    accountInnertube = innertube
  }

  return accountInnertube
}

/**
 * Creates a signed-in WEB client for account-library reads when the TV client returns
 * empty or incomplete history and playlist responses. OAuth tokens are shared between
 * InnerTube clients; account mutations continue to use the TV client explicitly.
 *
 * @returns {Promise<Innertube>}
 */
async function getYouTubeAccountWebInnertube() {
  const tokens = await getAccountTokens()

  if (tokens === null) {
    throw new Error('You must be signed in to your YouTube account.')
  }

  if (accountWebInnertube !== null) {
    return accountWebInnertube
  }

  if (accountWebInnertubePromise === null) {
    accountWebInnertubePromise = (async () => {
      const innertube = await createInnertube({ clientType: ClientType.WEB })

      innertube.session.on('update-credentials', ({ credentials }) => {
        saveAccountTokens({ ...accountTokens, ...credentials })
      })

      await innertube.session.signIn(tokens)

      if (!innertube.session.logged_in) {
        throw new Error('YouTube did not authenticate the saved account tokens with its WEB client.')
      }

      return innertube
    })()
  }

  try {
    accountWebInnertube = await accountWebInnertubePromise
    return accountWebInnertube
  } finally {
    accountWebInnertubePromise = null
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function isSignedInToYouTubeAccount() {
  if (!process.env.IS_ELECTRON) {
    return false
  }

  return (await getAccountTokens()) !== null
}

/**
 * Retrieves the details of the signed in account (name, avatar, channel) and stores them
 * in the main process so that the UI can show them without having to sign in again.
 *
 * @returns {Promise<{ signedIn: boolean, name?: string|null, channelId?: string|null, thumbnail?: string|null, handle?: string|null }>}
 */
export async function getYouTubeAccountInfo() {
  if (!process.env.IS_ELECTRON) {
    return { signedIn: false }
  }

  const innertube = await getYouTubeAccountInnertube()

  if (innertube === null) {
    return { signedIn: false }
  }

  try {
    const accountInfo = await innertube.account.getInfo()

    /** @type {import('youtubei.js').YTNodes.AccountItem} */
    const accountItem = accountInfo.contents?.contents?.find(item => item.type === 'AccountItem')

    // When the account switched to a brand channel, the channel itself is listed as a footer
    const accountChannel = accountInfo.contents?.footers?.firstOfType(YTNodes.AccountChannel)

    const channelId = accountItem?.endpoint?.payload?.browseId ??
      accountChannel?.endpoint?.payload?.browseId ??
      accountChannel?.endpoint?.payload?.browseEndpoint?.browseId ??
      null

    const accountDetails = {
      signedIn: true,
      name: accountItem?.account_name?.text ?? null,
      channelId,
      thumbnail: accountItem?.account_photo?.[0]?.url ?? null,
      handle: accountItem?.channel_handle?.text || null
    }

    await window.ftElectron.updateYouTubeAccountInfo(accountDetails)

    return accountDetails
  } catch (error) {
    console.error('failed to retrieve the YouTube account details', error)

    return { signedIn: true }
  }
}

/**
 * Retrieves the channels that the signed in account is subscribed to on YouTube.
 *
 * @returns {Promise<{ channels: { id: string, name: string, thumbnail: string }[], partial: boolean }>}
 */
export async function getYouTubeAccountSubscriptions() {
  const innertube = await getYouTubeAccountInnertube()

  if (innertube === null) {
    throw new Error('You must be signed in to your YouTube account.')
  }

  /** @type {Map<string, { id: string, name: string, thumbnail: string }>} */
  const channels = new Map()
  const sourceErrors = []
  let channelsFeedSucceeded = false
  let channelsFeedComplete = false
  let fallbackSourceSucceeded = false

  const addChannel = (id, name, thumbnail) => {
    // Ignore navigation entries in the guide (for example FEsubscriptions); actual
    // YouTube channel IDs begin with UC.
    if (typeof id === 'string' && id.startsWith('UC') && name && name !== 'N/A' && !channels.has(id)) {
      channels.set(id, { id, name, thumbnail: thumbnail ?? '' })
    }
  }

  // This is the complete subscriptions list when YouTube returns it for this client.
  // Some accounts/TV sessions do not expose FEchannels, so use the guide and activity
  // feed below as a fallback instead of failing the whole import.
  try {
    let channelsFeed = await innertube.getChannelsFeed()
    channelsFeedSucceeded = true

    for (let page = 0; page < CHANNELS_FEED_PAGES_TO_FETCH; page++) {
      for (const channel of channelsFeed.channels ?? []) {
        addChannel(
          channel.id,
          channel.author?.name,
          channel.author?.best_thumbnail?.url
        )
      }

      if (!channelsFeed.has_continuation) {
        channelsFeedComplete = true
        break
      }

      if (page === CHANNELS_FEED_PAGES_TO_FETCH - 1) {
        sourceErrors.push(new Error(`The YouTube subscription list exceeded the ${CHANNELS_FEED_PAGES_TO_FETCH}-page import limit.`))
        break
      }

      channelsFeed = await channelsFeed.getContinuation()
    }
  } catch (error) {
    sourceErrors.push(error)
    console.warn('failed to retrieve the YouTube channels list; trying other subscription sources', error)
  }

  const channelsFeedWasEmpty = channels.size === 0

  if (channelsFeedWasEmpty || sourceErrors.length > 0) {
    try {
      // SmartTube reads subscribed channels from FEsubscriptions TV navigation tabs.
      // Treat this as a partial fallback: YouTube may omit or change those tabs.
      const response = await innertube.actions.execute('/browse', { browseId: 'FEsubscriptions' })
      const tvChannels = getYouTubeAccountSubscriptionTabs(response)
      for (const channel of tvChannels) {
        addChannel(channel.id, channel.name, channel.thumbnail)
      }
      fallbackSourceSucceeded ||= tvChannels.length > 0
    } catch (error) {
      sourceErrors.push(error)
      console.warn('failed to retrieve YouTube TV subscription tabs', error)
    }

    try {
      const guide = await innertube.getGuide()
      fallbackSourceSucceeded = true

      for (const section of guide.contents ?? []) {
        for (const entry of section.items ?? []) {
          if (entry.type !== 'GuideEntry') {
            continue
          }

          /** @type {import('youtubei.js').YTNodes.GuideEntry} */
          const guideEntry = entry

          addChannel(
            guideEntry.endpoint?.payload?.browseId,
            guideEntry.title?.text,
            guideEntry.thumbnails?.at(-1)?.url
          )
        }
      }
    } catch (error) {
      sourceErrors.push(error)
      console.warn('failed to retrieve the YouTube subscriptions guide', error)
    }

    try {
      let feed = await innertube.getSubscriptionsFeed()
      fallbackSourceSucceeded = true

      for (let page = 0; page <= 5; page++) {
        for (const video of feed.videos ?? []) {
          addChannel(
            video.author?.id,
            video.author?.name,
            video.author?.best_thumbnail?.url
          )
        }

        if (!feed.has_continuation || page === 5) {
          break
        }

        feed = await feed.getContinuation()
      }
    } catch (error) {
      sourceErrors.push(error)
      console.warn('failed to retrieve the YouTube subscriptions activity feed', error)
    }
  }

  if (!channelsFeedSucceeded && !fallbackSourceSucceeded) {
    throw new Error('Unable to retrieve YouTube subscriptions. Check the account connection and try again.', {
      cause: sourceErrors.at(-1)
    })
  }

  return {
    channels: Array.from(channels.values()).sort((a, b) => a.name.localeCompare(b.name)),
    // The guide and recent activity feed cannot establish the full subscriptions list.
    partial: !channelsFeedComplete || channelsFeedWasEmpty
  }
}

/**
 * Subscribes to or unsubscribes from a channel on YouTube using the signed in account.
 *
 * @param {string} channelId
 * @param {boolean} subscribed
 */
export async function setYouTubeAccountSubscription(channelId, subscribed) {
  const innertube = await getYouTubeAccountInnertube()

  if (innertube === null) {
    throw new Error('You must be signed in to your YouTube account.')
  }

  if (subscribed) {
    await innertube.interact.subscribe(channelId)
  } else {
    await innertube.interact.unsubscribe(channelId)
  }
}

/**
 * Retrieves the activity feed (videos, Shorts and live streams) of the channels
 * that the signed in account is subscribed to on YouTube.
 *
 * @returns {Promise<{ videos: object[], source: string, partial: boolean, channelCount?: number, failedChannelCount?: number }>}
 */
export async function getYouTubeAccountActivityFeed() {
  const innertube = await getYouTubeAccountInnertube()

  if (innertube === null) {
    throw new Error('You must be signed in to your YouTube account.')
  }

  return loadAccountActivity({
    tv: innertube,
    getWebClient: getYouTubeAccountWebInnertube,
    getRawFeed: getYouTubeAccountRawBrowseFeed,
    getRows: getYouTubeAccountHistoryVideos,
    parseItems: parseYouTubeAccountFeedItems,
    getSubscriptions: getYouTubeAccountSubscriptions,
    getChannelVideos: getLocalChannelVideos,
  })
}

/**
 * Resolves account Library shelves from both the legacy Shelf node and the newer
 * GridShelfView node used by some YouTube responses.
 * @param {object} library
 * @param {string} sectionName
 * @param {string[]} titleAliases
 * @param {'history'|'playlist'} [feedType]
 * @returns {object|undefined}
 */
function getYouTubeAccountLibraryShelf(library, sectionName, titleAliases, feedType = undefined) {
  const shelf = library?.[sectionName]

  if (shelf) {
    return shelf
  }

  const normalizedTitles = new Set(titleAliases.map(title => title.toLowerCase()))
  const gridShelf = library?.memo?.getType(YTNodes.GridShelfView)?.find((candidate) => {
    const title = candidate.header?.title?.text ?? candidate.header?.title?.toString()

    return typeof title === 'string' && normalizedTitles.has(title.trim().toLowerCase())
  })

  if (!gridShelf) {
    return undefined
  }

  const resolvedShelf = { contents: gridShelf.contents ?? [] }

  if (feedType) {
    resolvedShelf.getAll = async () => {
      const endpoint = gridShelf.show_more_button?.on_tap

      if (!endpoint) {
        throw new Error(`The YouTube ${sectionName} shelf has no show-more endpoint.`)
      }

      const page = await endpoint.call(library.actions, { parse: true })

      if (feedType === 'history') {
        return new YT.History(library.actions, page, true)
      }

      return new YT.Playlist(library.actions, page, true)
    }
  }

  return resolvedShelf
}

/**
 * Reads an array-valued property while tolerating youtubei.js accessors that reject
 * a newer YouTube node type. This lets the account import try the alternate feed shape.
 * @param {object|undefined} value
 * @param {string} propertyName
 * @returns {object[]}
 */
function getYouTubeAccountFeedArray(value, propertyName) {
  try {
    const items = value?.[propertyName]

    return Array.isArray(items) ? items : []
  } catch (error) {
    console.warn(`failed to read YouTube account feed ${propertyName}; trying its alternate item shape`, error)
    return []
  }
}

/**
 * Returns history rows from both the normal feed accessor and its parsed sections.
 * Some YouTube history pages have nested rows that are absent from `feed.videos`.
 * @param {object|undefined} feed
 * @returns {object[]}
 */
function getYouTubeAccountHistoryVideos(feed) {
  const rows = [
    ...getYouTubeAccountFeedArray(feed, 'videos'),
    ...getYouTubeAccountFeedArray(feed, 'items'),
    ...getYouTubeAccountFeedArray(feed, 'sections').flatMap(section => getYouTubeAccountFeedArray(section, 'contents'))
  ]

  return Array.from(new Set(rows))
}

/**
 * Returns playlist rows from a parsed feed, preferring its `items` when present and
 * falling back to `videos` when the Playlist.items getter rejects a node type.
 * @param {object|undefined} feed
 * @returns {object[]}
 */
function getYouTubeAccountPlaylistVideos(feed) {
  const items = getYouTubeAccountFeedArray(feed, 'items')

  return items.length > 0 ? items : getYouTubeAccountFeedArray(feed, 'videos')
}

/**
 * Builds a minimal local video record when youtubei.js can see a video ID but its
 * current parser doesn't recognize the enclosing YouTube response node.
 * @param {object} item
 * @returns {object|null}
 */
function getYouTubeAccountVideoFallback(item) {
  try {
    const rawItem = getYouTubeAccountRawItem(item)
    const source = rawItem ?? item
    const type = typeof item?.type === 'string' ? item.type.toLowerCase() : ''
    const contentType = String(item?.content_type ?? source?.contentType ?? source?.content_type ?? '').toUpperCase()
    const isVideoLockup = ['VIDEO', 'MOVIE', 'SHORT', 'STATION'].some(value => contentType.includes(value))
    const isVideoTile = contentType === 'TILE_CONTENT_TYPE_VIDEO'
    const endpointPayloads = [
      item?.endpoint?.payload,
      item?.navigation_endpoint?.payload,
      item?.navigationEndpoint?.payload,
      item?.on_tap_endpoint?.payload,
      item?.onTapEndpoint?.payload,
      item?.service_endpoint?.payload,
      item?.serviceEndpoint?.payload,
      source?.endpoint,
      source?.navigationEndpoint,
      source?.onSelectCommand,
      source?.onTapEndpoint,
      source?.onTap,
      source?.serviceEndpoint,
      source?.rendererContext?.commandContext,
      source?.rendererContext?.commandContext?.onTap
    ]
    const endpointVideoId = endpointPayloads
      .map(payload => payload?.videoId ?? payload?.watchEndpoint?.videoId ?? payload?.reelWatchEndpoint?.videoId ??
        payload?.innertubeCommand?.watchEndpoint?.videoId ?? payload?.innertubeCommand?.reelWatchEndpoint?.videoId ??
        payload?.command?.watchEndpoint?.videoId ?? payload?.command?.reelWatchEndpoint?.videoId)
      .find(value => typeof value === 'string' && value.trim() !== '')
    const hasVideoNodeType = type.includes('video') || type.includes('movie') || type === 'reelitem' ||
      isVideoTile || rawItem !== undefined
    const videoId = item?.video_id ?? item?.videoId ?? source?.video_id ?? source?.videoId ?? endpointVideoId ??
      ((isVideoLockup || isVideoTile) ? source?.content_id ?? source?.contentId : undefined) ??
      (hasVideoNodeType ? item?.id ?? source?.id : undefined)

    if (typeof videoId !== 'string' || videoId.trim() === '') {
      return null
    }

    const normalizedVideoId = videoId.trim()
    const rawTitle = item?.title?.text ?? item?.title ?? item?.metadata?.title?.text ?? item?.overlay_metadata?.primary_text?.text ??
      source?.title ?? source?.metadata?.lockupMetadataViewModel?.title ??
      source?.metadata?.tileMetadataRenderer?.title ?? source?.overlay?.reelPlayerOverlayRenderer?.reelPlayerHeaderSupportedRenderers?.reelPlayerHeaderRenderer?.videoTitle
    const title = getYouTubeAccountRawText(rawTitle)
    const tileAuthorText = source?.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text
    const rawAuthor = item?.author?.name ?? item?.author?.text ?? item?.byline?.text ?? item?.owner?.name ??
      source?.author?.name ?? source?.author?.text ?? source?.shortBylineText ?? source?.longBylineText ?? tileAuthorText
    const author = getYouTubeAccountRawText(rawAuthor)
    const authorRuns = source?.shortBylineText?.runs ?? source?.longBylineText?.runs ?? []
    const authorId = item?.author?.id ?? source?.author?.id ?? authorRuns
      .map(run => run?.navigationEndpoint?.browseEndpoint?.browseId)
      .find(value => typeof value === 'string')
    const thumbnailList = source?.thumbnail?.thumbnails ?? source?.thumbnail
    const thumbnail = item?.thumbnails?.[0]?.url ?? (Array.isArray(thumbnailList) ? thumbnailList.at(-1)?.url : undefined) ??
      source?.content_image?.primary_thumbnail?.image?.[0]?.url ?? source?.content_image?.image?.[0]?.url ??
      source?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.at(-1)?.url
    const directLengthSeconds = item?.duration?.seconds ?? source?.duration?.seconds ?? source?.lengthSeconds
    const lengthText = getYouTubeAccountRawText(source?.lengthText ?? source?.durationText ??
      source?.header?.tileHeaderRenderer?.thumbnailOverlays?.find(overlay => overlay?.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text)
    const parsedLengthSeconds = Number.isFinite(directLengthSeconds)
      ? directLengthSeconds
      : lengthText
        ? Utils.timeToSeconds(lengthText)
        : undefined

    return {
      type: 'video',
      videoId: normalizedVideoId,
      title: title || `YouTube video ${normalizedVideoId}`,
      author,
      authorId: typeof authorId === 'string' ? authorId : null,
      thumbnail,
      liveNow: hasLiveBadge(source),
      lengthSeconds: Number.isFinite(parsedLengthSeconds) ? parsedLengthSeconds : ''
    }
  } catch (error) {
    console.warn('failed to extract a video ID from an unrecognized YouTube account item', error)
    return null
  }
}

/**
 * Requests a raw account browse page through the authenticated Innertube Actions instance.
 * @param {object|undefined} actions
 * @param {string} browseId
 * @returns {Promise<object|undefined>}
 */
async function getYouTubeAccountRawBrowseFeed(actions, browseId) {
  if (typeof actions?.execute !== 'function') {
    return undefined
  }

  const response = await actions.execute('/browse', { browseId })

  return createYouTubeAccountRawFeed(response, actions)
}

/**
 * Finds watch-history data for a single authenticated InnerTube client.
 * @param {Innertube} innertube
 * @param {string} clientLabel
 * @returns {Promise<{ feed: object|undefined, truncated: boolean, error: unknown, usesHistoryTimestamps: boolean }>}
 */
async function getYouTubeAccountHistoryFeed(innertube, clientLabel) {
  let historyFeed
  let historyFeedError
  let historyTruncated = false
  let usesHistoryTimestamps = true

  try {
    historyFeed = await innertube.getHistory()
  } catch (error) {
    historyFeedError = error
    console.warn(`failed to retrieve YouTube history with the ${clientLabel} client; trying its Library history shelf`, error)
  }

  if (!historyFeed || getYouTubeAccountHistoryVideos(historyFeed).length === 0) {
    try {
      // Use Innertube's Actions directly so this still works if the History parser fails
      // before it can construct a feed exposing the same Actions instance.
      const rawHistoryFeed = await getYouTubeAccountRawBrowseFeed(innertube.actions, 'FEhistory')

      if (getYouTubeAccountHistoryVideos(rawHistoryFeed).length > 0 || rawHistoryFeed?.has_continuation) {
        // The current youtubei.js History parser does not expose TV browse tabs as video rows.
        historyFeed = rawHistoryFeed
      }
    } catch (error) {
      historyFeedError ??= error
      console.warn(`failed to read the raw YouTube TV history page with the ${clientLabel} client`, error)
    }
  }

  if (!historyFeed || (!getYouTubeAccountHistoryVideos(historyFeed).length && !historyFeed.has_continuation)) {
    try {
      const library = await innertube.getLibrary()
      const historyShelf = getYouTubeAccountLibraryShelf(library, 'history', ['history', 'watch history'], 'history')
      let libraryHistoryFeed

      if (historyShelf?.getAll) {
        try {
          libraryHistoryFeed = await historyShelf.getAll()
        } catch (error) {
          historyTruncated = true
          historyFeedError ??= error
          console.warn(`failed to open the full YouTube Library history shelf with the ${clientLabel} client`, error)
        }
      }

      if (getYouTubeAccountHistoryVideos(libraryHistoryFeed).length > 0 || libraryHistoryFeed?.has_continuation) {
        historyFeed = libraryHistoryFeed
        usesHistoryTimestamps = true
      } else if (historyShelf?.contents?.length > 0 && (!historyFeed || !getYouTubeAccountHistoryVideos(historyFeed).length)) {
        // Some YouTube clients expose the recent history items on the Library shelf
        // but omit the shelf's "show all" button. Keep those visible recent items.
        // The visible shelf is only a preview, so report this as a partial import.
        historyFeed = {
          videos: historyShelf.contents,
          has_continuation: false
        }
        historyTruncated = true
        usesHistoryTimestamps = true
      } else if (!historyFeed && libraryHistoryFeed) {
        historyFeed = libraryHistoryFeed
        usesHistoryTimestamps = true
      }
    } catch (error) {
      historyFeedError ??= error
      console.warn(`failed to retrieve YouTube history from the Library shelf with the ${clientLabel} client`, error)
    }
  }

  // Some YouTube client responses leave FEhistory and the Library shelf empty even
  // when the account has history. YouTube also exposes that data as the HL playlist.
  if (!historyFeed || !getYouTubeAccountHistoryVideos(historyFeed).length || historyTruncated) {
    try {
      let historyPlaylistFeed

      try {
        historyPlaylistFeed = await innertube.getPlaylist('HL')
      } catch (error) {
        historyFeedError ??= error
        console.warn(`failed to parse the YouTube HL playlist with the ${clientLabel} client; trying its raw browse result`, error)
      }

      if (!historyPlaylistFeed || getYouTubeAccountHistoryVideos(historyPlaylistFeed).length === 0) {
        try {
          const rawHistoryPlaylistFeed = await getYouTubeAccountRawBrowseFeed(innertube.actions, 'VLHL')

          if (getYouTubeAccountHistoryVideos(rawHistoryPlaylistFeed).length > 0 || rawHistoryPlaylistFeed?.has_continuation) {
            historyPlaylistFeed = rawHistoryPlaylistFeed
          }
        } catch (error) {
          historyFeedError ??= error
          console.warn(`failed to read the raw YouTube HL playlist with the ${clientLabel} client`, error)
        }
      }

      if (getYouTubeAccountHistoryVideos(historyPlaylistFeed).length > 0 || historyPlaylistFeed?.has_continuation) {
        historyFeed = historyPlaylistFeed
        historyTruncated = false
        usesHistoryTimestamps = false
      } else if (!historyFeed && historyPlaylistFeed) {
        historyFeed = historyPlaylistFeed
        usesHistoryTimestamps = false
      }
    } catch (error) {
      historyFeedError ??= error
      console.warn(`failed to retrieve YouTube watch history from its HL playlist with the ${clientLabel} client`, error)
    }
  }

  return {
    feed: historyFeed,
    truncated: historyTruncated,
    error: historyFeedError,
    usesHistoryTimestamps
  }
}

/**
 * Imports recent videos from the signed-in YouTube account's watch history.
 * This reads YouTube's history and does not upload FreeTube's local history.
 *
 * Each sync is capped to recent pages so a very large Google account does not
 * stall app startup indefinitely.
 *
 * @returns {Promise<{ history: object[], truncated: boolean }>}
 */
export async function getYouTubeAccountHistory() {
  const innertube = await getYouTubeAccountInnertube()

  if (innertube === null) {
    throw new Error('You must be signed in to your YouTube account.')
  }

  let {
    feed: historyFeed,
    truncated: historyTruncated,
    error: historyFeedError,
    usesHistoryTimestamps
  } = await getYouTubeAccountHistoryFeed(innertube, 'TV')

  // The TV client is used for OAuth and account mutations, but some signed-in TV
  // responses omit account library contents that are present on YouTube's WEB client.
  // Retry only empty or already-incomplete results; keep the normal sync to one client.
  if (!getYouTubeAccountHistoryVideos(historyFeed).length || historyTruncated) {
    try {
      const webInnertube = await getYouTubeAccountWebInnertube()
      const webHistory = await getYouTubeAccountHistoryFeed(webInnertube, 'WEB')
      const webFeedHasData = getYouTubeAccountHistoryVideos(webHistory.feed).length > 0 || webHistory.feed?.has_continuation

      if (webFeedHasData) {
        historyFeed = webHistory.feed
        historyTruncated = webHistory.truncated
        usesHistoryTimestamps = webHistory.usesHistoryTimestamps
      } else if (!historyFeed && webHistory.feed) {
        historyFeed = webHistory.feed
        historyTruncated = webHistory.truncated
        usesHistoryTimestamps = webHistory.usesHistoryTimestamps
      }

      historyFeedError ??= webHistory.error
    } catch (error) {
      historyFeedError ??= error
      console.warn('failed to retry YouTube watch history with the WEB client', error)
    }
  }

  if (!historyFeed) {
    throw new Error('Unable to retrieve YouTube watch history. Check the account connection and try again.', {
      cause: historyFeedError
    })
  }

  const historyByVideoId = new Map()
  const fallbackTime = Date.now()
  let historyItemsRead = 0

  for (let page = 0; page < YOUTUBE_ACCOUNT_HISTORY_PAGES_TO_FETCH; page++) {
    for (const video of getYouTubeAccountHistoryVideos(historyFeed)) {
      historyItemsRead++
      let videoData

      if (getYouTubeAccountRawItem(video)) {
        videoData = getYouTubeAccountVideoFallback(video)
      } else {
        try {
          videoData = parseLocalListVideo(video)
        } catch (error) {
          console.warn('failed to parse a YouTube history item using the list parser; trying the playlist parser', error)
        }

        if (!videoData?.videoId) {
          try {
            videoData = parseLocalPlaylistVideos([video])[0]
          } catch (error) {
            console.warn('skipping a YouTube history item that could not be parsed', error)
          }
        }

        videoData ??= getYouTubeAccountVideoFallback(video)
      }

      if (!videoData?.videoId) {
        historyTruncated = true
        continue
      }

      if (historyByVideoId.has(videoData.videoId)) {
        continue
      }

      const watchedAt = usesHistoryTimestamps
        ? parseYouTubeAccountHistoryTime(video.published?.text)
        : undefined

      historyByVideoId.set(videoData.videoId, {
        ...videoData,
        // The history page's published text is the watch time, not the video's upload date.
        published: undefined,
        watchProgress: 0,
        timeWatched: watchedAt ?? fallbackTime - historyByVideoId.size,
        isLive: false,
        isStation: false,
        isPremiere: false,
        type: 'video'
      })
    }

    if (!historyFeed.has_continuation) {
      break
    }

    if (page === YOUTUBE_ACCOUNT_HISTORY_PAGES_TO_FETCH - 1) {
      historyTruncated = true
      break
    }

    try {
      historyFeed = await historyFeed.getContinuation()
    } catch (error) {
      historyTruncated = true
      console.warn('YouTube history continuation failed; keeping the pages already imported', error)

      if (historyByVideoId.size === 0) {
        throw error
      }

      break
    }
  }

  if (historyItemsRead > 0 && historyByVideoId.size === 0) {
    throw new Error('YouTube returned watch-history items, but FreeTube could not parse any of them.')
  }

  if (historyItemsRead === 0) {
    console.warn('YouTube returned no watch-history items for the signed-in account.')
  }

  return {
    history: Array.from(historyByVideoId.values()),
    truncated: historyTruncated
  }
}

/**
 * Imports custom YouTube playlists plus Watch Later and Liked videos.
 * This is a read-only account operation; it never creates or edits playlists on YouTube.
 *
 * @returns {Promise<{ playlists: object[], truncated: boolean, failedPlaylistCount: number }>}
 */
export async function getYouTubeAccountPlaylists() {
  const innertube = await getYouTubeAccountInnertube()

  if (innertube === null) {
    throw new Error('You must be signed in to your YouTube account.')
  }

  /** @type {Map<string, { id: string, title: string, firstVideos: object[] }>} */
  const playlistSummaries = new Map()
  /** @type {object[]} */
  const playlists = []
  const sourceErrors = []
  let playlistIndexSucceeded = false
  let playlistIndexFailed = false
  let libraryFailed = false
  let playlistInnertube = innertube
  let webPlaylistInnertube = null
  let truncated = false
  let failedPlaylistCount = 0
  let remainingContentPages = YOUTUBE_ACCOUNT_PLAYLIST_CONTENT_PAGES_TO_FETCH

  const addPlaylistSummary = (item) => {
    const rawId = item?.id ?? item?.content_id ?? item?.endpoint?.payload?.playlistId ?? item?.endpoint?.payload?.browseId

    if (typeof rawId !== 'string' || rawId.length === 0) {
      truncated = true
      return
    }

    const id = rawId.startsWith('VL') ? rawId.slice(2) : rawId

    if (id.length === 0) {
      truncated = true
      return
    }

    // These are imported from their dedicated Library shelves below. Mixes do not
    // have stable playlist pages that FreeTube can store as local playlists.
    if (['WL', 'LL', 'HL'].includes(id) || id.startsWith('RD')) {
      return
    }

    const title = item?.title?.text ?? item?.metadata?.title?.text

    if (typeof title !== 'string' || title.trim() === '') {
      truncated = true
      return
    }

    if (!playlistSummaries.has(id)) {
      playlistSummaries.set(id, {
        id,
        title: title.trim(),
        firstVideos: item?.first_videos ?? []
      })
    }
  }

  const readPlaylistIndex = async (initialFeed) => {
    let feed = initialFeed

    for (let page = 0; page < YOUTUBE_ACCOUNT_PLAYLIST_INDEX_PAGES_TO_FETCH; page++) {
      for (const playlist of getYouTubeAccountFeedArray(feed, 'playlists')) {
        addPlaylistSummary(playlist)
      }

      if (!feed?.has_continuation) {
        break
      }

      if (page === YOUTUBE_ACCOUNT_PLAYLIST_INDEX_PAGES_TO_FETCH - 1) {
        truncated = true
        break
      }

      feed = await feed.getContinuation()
    }
  }

  const tryReadRawPlaylistIndex = async (actions, clientLabel) => {
    try {
      const rawFeed = await getYouTubeAccountRawBrowseFeed(actions, 'FEplaylist_aggregation')

      if (getYouTubeAccountFeedArray(rawFeed, 'playlists').length > 0 || rawFeed?.has_continuation) {
        await readPlaylistIndex(rawFeed)
        playlistIndexSucceeded = true
        playlistIndexFailed = false
        return true
      }
    } catch (error) {
      sourceErrors.push(error)
      console.warn(`failed to read the raw YouTube playlist index with the ${clientLabel} client`, error)
    }

    return false
  }

  // This endpoint is the primary source for the account's custom playlists.
  try {
    const feed = await innertube.getPlaylists()
    playlistIndexSucceeded = true
    await readPlaylistIndex(feed)
  } catch (error) {
    sourceErrors.push(error)
    playlistIndexFailed = true
    console.warn('failed to retrieve YouTube playlist index; trying the Library shelf', error)
  }

  // TV browse responses currently use tvBrowseRenderer tabs that youtubei.js may
  // leave out of Feed.playlists. Read the authenticated endpoint raw if parsing failed
  // or yielded no playlist cards.
  if (playlistSummaries.size === 0) {
    await tryReadRawPlaylistIndex(innertube.actions, 'TV')
  }

  let library

  try {
    library = await innertube.getLibrary()
    playlistIndexSucceeded = true
    const playlistsShelf = getYouTubeAccountLibraryShelf(library, 'playlists_section', ['playlists'])

    for (const playlist of playlistsShelf?.contents ?? []) {
      addPlaylistSummary(playlist)
    }
  } catch (error) {
    sourceErrors.push(error)
    libraryFailed = true
    console.warn('failed to retrieve the YouTube Library while syncing playlists', error)
  }

  // If the TV client returned no playlist summaries or one of its account-library
  // reads failed, retry the index and shelves with the WEB client before reporting an
  // empty account. Keep the TV result when it already contains usable playlist data.
  if (playlistSummaries.size === 0 || playlistIndexFailed || libraryFailed) {
    try {
      webPlaylistInnertube = await getYouTubeAccountWebInnertube()
      let webIndexSucceeded = false
      let webLibrarySucceeded = false

      try {
        const feed = await webPlaylistInnertube.getPlaylists()
        webIndexSucceeded = true
        playlistIndexSucceeded = true
        playlistIndexFailed = false
        await readPlaylistIndex(feed)
      } catch (error) {
        sourceErrors.push(error)
        playlistIndexFailed = true
        console.warn('failed to retrieve the YouTube playlist index with the WEB client', error)
      }

      if (playlistSummaries.size === 0) {
        webIndexSucceeded = await tryReadRawPlaylistIndex(webPlaylistInnertube.actions, 'WEB') || webIndexSucceeded
      }

      try {
        const webLibrary = await webPlaylistInnertube.getLibrary()
        webLibrarySucceeded = true
        libraryFailed = false
        playlistIndexSucceeded = true

        const webPlaylistsShelf = getYouTubeAccountLibraryShelf(webLibrary, 'playlists_section', ['playlists'])

        for (const playlist of webPlaylistsShelf?.contents ?? []) {
          addPlaylistSummary(playlist)
        }

        const hasTVPlaylistShelves = [
          ['watch_later', ['watch later']],
          ['liked_videos', ['liked videos', 'likes']],
          ['playlists_section', ['playlists']]
        ].some(([sectionName, titleAliases]) => getYouTubeAccountLibraryShelf(library, sectionName, titleAliases) !== undefined)

        if (!hasTVPlaylistShelves) {
          library = webLibrary
        }
      } catch (error) {
        sourceErrors.push(error)
        libraryFailed = true
        console.warn('failed to retrieve the YouTube Library with the WEB client', error)
      }

      if (webIndexSucceeded || webLibrarySucceeded) {
        playlistInnertube = webPlaylistInnertube
      }

      if (playlistSummaries.size === 0 && (!webIndexSucceeded || !webLibrarySucceeded)) {
        truncated = true
      }
    } catch (error) {
      sourceErrors.push(error)
      truncated = true
      console.warn('failed to create the YouTube WEB client while syncing playlists', error)
    }
  }

  if (playlistIndexFailed || libraryFailed) {
    truncated = true
  }

  if (!playlistIndexSucceeded) {
    throw new Error('Unable to retrieve YouTube playlists. Check the account connection and try again.', {
      cause: sourceErrors.at(-1)
    })
  }

  if (playlistSummaries.size > YOUTUBE_ACCOUNT_PLAYLISTS_TO_FETCH) {
    truncated = true
  }

  const readPlaylistVideos = async (initialFeed, fallbackItems = [], reservedPages = YOUTUBE_ACCOUNT_SYSTEM_PLAYLIST_CONTENT_PAGE_RESERVE) => {
    let feed = initialFeed
    let pagesFetched = 0
    const videos = []
    const videoIds = new Set()

    while (remainingContentPages > reservedPages && pagesFetched < 20) {
      remainingContentPages--
      pagesFetched++

      const feedItems = getYouTubeAccountPlaylistVideos(feed)
      const useFallbackItems = !feedItems?.length && fallbackItems.length > 0
      const items = useFallbackItems ? fallbackItems : feedItems ?? []

      if (useFallbackItems && feed) {
        // The summary's preview is not a full substitute for an empty playlist page.
        truncated = true
      }

      for (const item of items) {
        let video

        if (getYouTubeAccountRawItem(item)) {
          video = getYouTubeAccountVideoFallback(item)
        } else {
          try {
            video = parseLocalPlaylistVideos([item])[0]
          } catch (error) {
            console.warn('failed to parse a YouTube playlist item with the playlist parser; trying the list parser', error)
          }

          if (!video?.videoId) {
            try {
              video = parseLocalListVideo(item)
            } catch (error) {
              console.warn('skipping a YouTube playlist item that could not be parsed', error)
            }
          }

          video ??= getYouTubeAccountVideoFallback(item)
        }

        if (!video?.videoId) {
          truncated = true
          continue
        }

        if (!videoIds.has(video.videoId)) {
          videoIds.add(video.videoId)
          videos.push(video)
        }
      }

      if (!feed?.has_continuation) {
        break
      }

      if (pagesFetched === 20 || remainingContentPages <= reservedPages) {
        truncated = true
        break
      }

      try {
        feed = await feed.getContinuation()
      } catch (error) {
        truncated = true
        console.warn('YouTube playlist continuation failed; keeping the items already imported', error)
        break
      }
    }

    return videos
  }

  const hasPlaylistFeedData = (feed) => Boolean(getYouTubeAccountPlaylistVideos(feed).length || feed?.has_continuation)

  const getRawPlaylistFeed = async (feed, playlistId, actions) => {
    if (getYouTubeAccountPlaylistVideos(feed).length > 0) {
      return feed
    }

    const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`
    const rawFeed = await getYouTubeAccountRawBrowseFeed(actions ?? feed?.actions, browseId)

    return hasPlaylistFeedData(rawFeed) ? rawFeed : feed
  }

  const fetchPlaylistFeed = async (client, playlistId) => {
    let feed
    let fetchError

    try {
      feed = await client.getPlaylist(playlistId)
    } catch (error) {
      fetchError = error
    }

    try {
      feed = await getRawPlaylistFeed(feed, playlistId, client.actions)
    } catch (error) {
      fetchError ??= error
    }

    if (fetchError && !hasPlaylistFeedData(feed)) {
      throw fetchError
    }

    return feed
  }

  const getAlternatePlaylistFeed = async (playlistId) => {
    if (playlistInnertube === innertube) {
      webPlaylistInnertube ??= await getYouTubeAccountWebInnertube()

      if (playlistInnertube === webPlaylistInnertube) {
        return undefined
      }

      return await fetchPlaylistFeed(webPlaylistInnertube, playlistId)
    }

    return await fetchPlaylistFeed(innertube, playlistId)
  }

  const customPlaylistSummaries = Array.from(playlistSummaries.values()).slice(0, YOUTUBE_ACCOUNT_PLAYLISTS_TO_FETCH)

  for (const [index, summary] of customPlaylistSummaries.entries()) {
    let playlistFeed
    let playlistFetchError

    try {
      playlistFeed = await fetchPlaylistFeed(playlistInnertube, summary.id)
    } catch (error) {
      playlistFetchError = error
    }

    if (!hasPlaylistFeedData(playlistFeed)) {
      try {
        const alternatePlaylistFeed = await getAlternatePlaylistFeed(summary.id)

        if (hasPlaylistFeedData(alternatePlaylistFeed) || (!playlistFeed && alternatePlaylistFeed)) {
          playlistFeed = alternatePlaylistFeed
          playlistFetchError = undefined
        }
      } catch (error) {
        playlistFetchError ??= error
      }
    }

    if (playlistFeed) {
      const videos = await readPlaylistVideos(playlistFeed, summary.firstVideos)
      const title = playlistFeed.info?.title ?? summary.title

      playlists.push({
        _id: `youtube-account-${summary.id}`,
        playlistName: `YouTube: ${title}`,
        description: playlistFeed.info?.description ?? '',
        videos
      })
    } else {
      console.warn(`failed to retrieve YouTube playlist ${summary.id}`, playlistFetchError)

      const videos = await readPlaylistVideos(null, summary.firstVideos)

      if (videos.length > 0) {
        playlists.push({
          _id: `youtube-account-${summary.id}`,
          playlistName: `YouTube: ${summary.title}`,
          description: '',
          videos
        })
      }

      // Avoid making an import of many playlists look completely successful when
      // YouTube denied access to one or more of them.
      failedPlaylistCount++
      sourceErrors.push(playlistFetchError)
    }

    if (remainingContentPages <= YOUTUBE_ACCOUNT_SYSTEM_PLAYLIST_CONTENT_PAGE_RESERVE) {
      if (index < customPlaylistSummaries.length - 1) {
        truncated = true
      }

      break
    }
  }

  const importLibraryShelf = async ({ shelf, playlistId, localId, playlistName, reservedPages }) => {
    let playlistFeed
    let playlistFetchError

    // The TV client's Library shelves are not always exposed by the parser. Fetch the
    // stable Watch Later / Liked playlist IDs directly first, then use the Library
    // shelf's "show all" endpoint and visible items as fallbacks.
    try {
      playlistFeed = await fetchPlaylistFeed(playlistInnertube, playlistId)
    } catch (error) {
      playlistFetchError = error
    }

    if (!hasPlaylistFeedData(playlistFeed) && shelf?.getAll) {
      try {
        const shelfFeed = await shelf.getAll()
        const rawShelfFeed = await getRawPlaylistFeed(shelfFeed, playlistId)

        if (hasPlaylistFeedData(rawShelfFeed) || (!playlistFeed && rawShelfFeed)) {
          playlistFeed = rawShelfFeed
          playlistFetchError = undefined
        }
      } catch (error) {
        playlistFetchError = error
      }
    }

    if (!hasPlaylistFeedData(playlistFeed)) {
      try {
        const alternatePlaylistFeed = await getAlternatePlaylistFeed(playlistId)

        if (hasPlaylistFeedData(alternatePlaylistFeed) || (!playlistFeed && alternatePlaylistFeed)) {
          playlistFeed = alternatePlaylistFeed
          playlistFetchError = undefined
        }
      } catch (error) {
        playlistFetchError ??= error
      }
    }

    if (!playlistFeed) {
      truncated = true
      failedPlaylistCount++
      console.warn(`failed to retrieve YouTube's ${playlistName} list`, playlistFetchError)

      if (!shelf?.contents?.length) {
        return
      }
    }

    const videos = await readPlaylistVideos(playlistFeed, shelf?.contents ?? [], reservedPages)

    playlists.push({
      _id: localId,
      playlistName,
      description: `Imported from YouTube ${playlistName} (${playlistId})`,
      videos
    })
  }

  await importLibraryShelf({
    shelf: getYouTubeAccountLibraryShelf(library, 'watch_later', ['watch later'], 'playlist'),
    playlistId: 'WL',
    localId: 'watchLater',
    playlistName: 'Watch Later',
    reservedPages: 1
  })
  await importLibraryShelf({
    shelf: getYouTubeAccountLibraryShelf(library, 'liked_videos', ['liked videos', 'likes'], 'playlist'),
    playlistId: 'LL',
    localId: 'favorites',
    playlistName: 'Favorites',
    reservedPages: 0
  })

  if (playlistSummaries.size === 0 && playlists.every(playlist => playlist.videos.length === 0)) {
    // Two empty system-list wrappers are not evidence that the account playlist data
    // was actually returned. Surface a zero-data result as partial instead of success.
    truncated = true
  }

  return { playlists, truncated, failedPlaylistCount }
}

/**
 * Converts a YouTube history row's relative or absolute timestamp to epoch milliseconds.
 * @param {string|undefined} watchedText
 * @returns {number|undefined}
 */
export function parseYouTubeAccountHistoryTime(watchedText) {
  if (!watchedText) {
    return undefined
  }

  const relativeText = watchedText.match(/\d+\s?(?:seconds?|s|minutes?|mins?|m|hours?|h|days?|d|weeks?|w|months?|mo|years?|y)\b/i)?.[0]

  if (relativeText) {
    return calculatePublishedDate(relativeText)
  }

  const dateText = watchedText.replace(/^(?:you\s+)?watched\s+(?:on\s+)?/i, '').trim()
  const timestamp = Date.parse(dateText)

  return Number.isFinite(timestamp) ? timestamp : undefined
}

/**
 * Videos are parsed with `parseLocalListVideo`, so this also covers the
 * `LockupView` items that YouTube uses in the subscriptions feed nowadays.
 *
 * @param {import('youtubei.js').Helpers.YTNode[]} items
 * @returns {object[]}
 */
export function parseYouTubeAccountFeedItems(items) {
  return items.map(item => {
    if (getYouTubeAccountRawItem(item)) return getYouTubeAccountVideoFallback(item)
    try {
      const parsed = parseListItem(item)
      if (parsed?.type === 'video' && parsed.videoId) return parsed
    } catch (error) {
      console.warn('Could not parse a subscription video; trying a fallback', error)
    }
    return getYouTubeAccountVideoFallback(item)
  }).filter(item => item?.type === 'video' && item.videoId)
}
/**
 * Open YouTube's home or Live browse page. Prefer the signed-in TV client when
 * available; use a fresh public client if the account response cannot be read.
 * Live search is a last resort if the Live browse page is unavailable.
 * @param {'discover'|'live'} kind
 * @param {boolean} safetyMode
 * @param {boolean} signedIn
 */
export async function openDiscoveryFeed(kind, safetyMode = false, signedIn = false) {
  if (!['discover', 'live'].includes(kind)) throw new Error('Unknown discovery feed')
  const browseId = kind === 'live' ? 'FEtopics_live' : 'FEwhat_to_watch'
  const errors = []
  const clients = [
    ...(signedIn && !safetyMode ? [() => getYouTubeAccountInnertube(), () => getYouTubeAccountWebInnertube()] : []),
    ...(!signedIn || safetyMode
      ? [
          () => createInnertube({ clientType: ClientType.TV, userAgent: TV_CLIENT_USER_AGENT, safetyMode }),
          () => createInnertube({ clientType: ClientType.WEB, safetyMode }),
        ]
      : []),
  ]

  const wrap = feed => ({
    videos: parseYouTubeAccountFeedItems(getYouTubeAccountHistoryVideos(feed))
      .filter(video => kind !== 'live' || video.liveNow === true),
    has_continuation: Boolean(feed?.has_continuation),
    async getContinuation() {
      return wrap(await feed.getContinuation())
    }
  })

  for (const getClient of clients) {
    try {
      const client = await getClient()
      if (!client) continue
      const response = await client.actions.execute('/browse', { browseId })
      const raw = createYouTubeAccountRawFeed(response, client.actions)
      let feed = wrap(raw)
      if (!feed.videos.length) {
        // Web clients may have parsed renderers that raw TV extraction does not know.
        try { feed = wrap(new Mixins.Feed(client.actions, response)) } catch (error) { errors.push(error) }
      }
      if (!feed.videos.length && feed.has_continuation) feed = await feed.getContinuation()
      if (feed.videos.length) return feed
    } catch (error) {
      errors.push(error)
      console.warn('Could not open a YouTube discovery feed', error)
    }
  }

  if (kind === 'live') {
    try {
      const result = await getLocalSearchResults('live', { type: 'video', features: ['live'] }, safetyMode)
      const videos = result.results.filter(video => video.type === 'video' && video.liveNow === true)
      if (videos.length) return { videos, has_continuation: false }
    } catch (error) {
      errors.push(error)
    }
  }
  throw new Error('Unable to load YouTube discovery videos.', { cause: errors.at(-1) })
}

// #endregion YouTube account

/**
 * @param {string} query
 * @param {object} filters
 * @param {boolean} safetyMode
 */
export async function getLocalSearchResults(query, filters, safetyMode) {
  const innertube = await createInnertube({ safetyMode })
  const response = await innertube.search(query, convertSearchFilters(filters))

  return handleSearchResponse(response)
}

/**
 * @param {YT.Search | SerializedContinuation} continuationData
 */
export async function getLocalSearchContinuation(continuationData) {
  let response

  if (continuationData instanceof YT.Search) {
    response = await continuationData.getContinuation()
  } else {
    response = await getLocalCachedFeedContinuation('search', continuationData)
  }

  return handleSearchResponse(response)
}

/**
 * @param {string} url
 * @param {string} kind
 */
async function getHTMLPage(url, kind) {
  // This returns session/tracking cookies but they get removed in onHeadersReceived in the main process before they are saved by Electron
  const htmlResponse = await fetch(url,
    {
      headers: {
        // We need to be able to parse the localised strings in the /next response data (e.g. view counts and published dates)
        'Accept-Language': 'en-US',
        ...(
          // The "Cookie" header is forbidden by the fetch spec, so we set it as X-Cookie here
          // and then convert it to the Cookie header in the main process
          process.env.IS_ELECTRON
            ? {
                'X-Cookie': `PREF=tz=${Intl.DateTimeFormat().resolvedOptions().timeZone.replace('/', '.')}`
              }
            : {}
        )
      }
    }
  )

  const htmlPage = await htmlResponse.text()

  const ytConfigStr = htmlPage.match(/ytcfg\.set\(({.+?})\);/s)?.[1]
  if (!ytConfigStr) {
    // required for botguard
    throw new Error(`Could not find ytcfg in the ${kind} HTML page`)
  }

  const ytConfig = JSON.parse(ytConfigStr)

  const initialAttestationDataMatch = htmlPage.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)

  if (!initialAttestationDataMatch) {
    // required for botguard
    throw new Error(`Could not find challenge in the ${kind} HTML page`)
  }

  let initialAttestationData

  try {
    initialAttestationData = parseLooseJSON(initialAttestationDataMatch[1])
  } catch (e) {
    const error = new Error(`Failed to parse the ${kind} home page initial attestation data`, { cause: e })
    console.error(error, initialAttestationDataMatch[1])
    throw error
  }

  let playerId = ytConfig.PLAYER_JS_URL?.match(/player\/([^/]+)\//)?.[1]

  playerId ??= htmlPage.match(/<script[^>]+src="[^">]+player\/([^/]+)\/[^"]+\/base.js"/)?.[1]

  return {
    htmlPage,
    ytConfig,
    initialAttestationData,
    playerId
  }
}

/**
 * @param {string} videoId
 * @param {(input, init) => Promise<Response>} fetchFunc
 */
async function getWatchHTMLWatchPage(videoId, fetchFunc) {
  let htmlPage, ytConfig, initialAttestationData

  let playerResponse, nextResponse
  /** @type {string | undefined} */
  let playerId

  if (sessionStorage.getItem('playerHtmlHomepageFallback') === '1') {
    ({ ytConfig, initialAttestationData, playerId } = await getHTMLPage('https://www.youtube.com', 'home'))
  } else {
    try {
      ({ htmlPage, ytConfig, initialAttestationData, playerId } = await getHTMLPage(`https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`, 'watch'))

      const playerResponseStr = htmlPage.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/)?.[1]

      // not fatal if it is missing as we can retrieve it from Innertube ourselves
      if (playerResponseStr) {
        try {
          playerResponse = JSON.parse(playerResponseStr)
        } catch (e) {
          console.warn('/player response extracted from the HTML page is invalid JSON', e)
        }
      } else {
        console.warn('Could not find /player response in the HTML page')
      }

      const nextResponseStr = htmlPage.match(/(?:window\s*\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*(\{.+?\});/)?.[1]

      // not fatal if it is missing as we can retrieve it from Innertube ourselves
      if (nextResponseStr) {
        try {
          nextResponse = JSON.parse(nextResponseStr)
        } catch (e) {
          console.warn('/next response extracted from the HTML page is invalid JSON', e)
        }
      } else {
        console.warn('Could not find /next response in the HTML page')
      }
    } catch (watchError) {
      console.warn('Falling back to the YT home page for the rest of the session because of:', watchError)

      // Fall back to the home page for the rest of the session/until FreeTube is restarted
      // assuming that getting the watch page captcha once is a sign that it will continue happening
      sessionStorage.setItem('playerHtmlHomepageFallback', '1');

      ({ ytConfig, initialAttestationData, playerId } = await getHTMLPage('https://www.youtube.com', 'home'))
    }
  }

  const session = buildSessionFromYtConfig(ytConfig, fetchFunc)

  return {
    ytConfig,
    initialAttestationData,
    session,
    playerId,
    playerResponse,
    nextResponse
  }
}

/**
 * @param {object} ytConfig
 * @param {(input, init) => Promise<Response>} fetchFunc
 */
function buildSessionFromYtConfig(ytConfig, fetchFunc) {
  const context = deepCopy(ytConfig.INNERTUBE_CONTEXT)

  if (context.clickTracking) {
    delete context.clickTracking
  }

  context.client.timeZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone
  context.client.screenDensityFloat ??= 1
  context.client.screenHeightPoints ??= 1440
  context.client.screenPixelDensity ??= 1
  context.client.screenWidthPoints ??= 2560
  context.client.utcOffsetMinutes ??= -Math.floor((new Date()).getTimezoneOffset())
  context.client.memoryTotalKbytes ??= '8000000'

  context.client.mainAppWebInfo ??= {
    graftUrl: Constants.URLS.YT_BASE,
    pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
    webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
    isWebNativeShareAvailable: true
  }

  context.client.configInfo ??= {}
  context.client.configInfo.coldConfigData ??= ytConfig.RAW_COLD_CONFIG_GROUP?.configData
  context.client.configInfo.coldHashData ??= ytConfig.SERIALIZED_COLD_HASH_DATA
  context.client.configInfo.hotHashData ??= ytConfig.SERIALIZED_HOT_HASH_DATA

  context.user = {
    enableSafetyMode: false,
    lockedSafetyMode: false,
  }

  return new Session(
    context, ytConfig.INNERTUBE_API_KEY, ytConfig.INNERTUBE_API_VERSION,
    0, undefined, undefined, undefined, fetchFunc
  )
}

/**
 * @param {string} videoId
 * @param {number} signatureTimestamp
 * @param {string} poToken
 * @param {string | undefined} [clientOverride]
 */
function createPlayerRequestBody(videoId, signatureTimestamp, poToken, clientOverride) {
  return {
    videoId,
    racyCheckOk: true,
    contentCheckOk: true,
    playbackContext: {
      contentPlaybackContext: {
        vis: 0,
        splay: false,
        lactMilliseconds: '-1',
        signatureTimestamp
      }
    },
    serviceIntegrityDimensions: {
      poToken
    },
    client: clientOverride
  }
}

/**
 * @param {string} videoId
 */
function createWatchNextRequestBody(videoId) {
  return {
    videoId,
    racyCheckOk: true,
    contentCheckOk: true,
    playbackContext: {
      vis: 0,
      lactMilliseconds: '-1'
    }
  }
}

/**
 * @param {string} id
 * @returns {Promise<{
 *   info: import('youtubei.js').YT.VideoInfo,
 *   poToken: string | undefined,
 *   clientInfo: {
 *     clientName: number,
 *     clientVersion: string,
 *     osName: string,
 *     osVersion: string
 *   },
 *   adEndTimeUnixMs: number
 * }>}
 */
export async function getLocalVideoInfo(id) {
  let responseTime
  let totalAdTimeMilliseconds = 0

  const fetchFunc = async (input, init) => {
    if (!(input.url?.startsWith('https://www.youtube.com/youtubei/v1/player'))) {
      return fetch(input, init)
    }

    const response = await fetch(input, init)
    const responseText = await response.text()

    responseTime = Date.now()

    const json = JSON.parse(responseText)

    totalAdTimeMilliseconds = extractTotalAdTimeMilliseconds(json)

    // Need to return a new response object, as you can only read the response body once.
    return new Response(responseText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

  const htmlExtracts = await getWatchHTMLWatchPage(id, fetchFunc)
  responseTime = Date.now()

  const player = await Player.create(
    process.env.IS_ELECTRON ? new PlayerCache() : new UniversalCache(false),
    (input, init) => fetch(input, init),
    undefined,
    // If we found the player ID in the HTML we can pass it in to save one request inside Player.create()
    htmlExtracts.playerId
  )

  // based on the videoId
  let contentPoToken

  if (process.env.IS_ELECTRON) {
    try {
      contentPoToken = await window.ftElectron.generatePoToken(
        id,
        JSON.stringify(htmlExtracts.session.context),
        JSON.stringify(htmlExtracts.initialAttestationData),
        JSON.stringify(htmlExtracts.ytConfig)
      )

      player.po_token = contentPoToken
    } catch (error) {
      console.error('Local API, poToken generation failed', error)
      throw error
    }
  }

  let playerResponse
  let nextResponse
  const context = htmlExtracts.session.context

  if (!htmlExtracts.playerResponse && !htmlExtracts.nextResponse) {
    const combinedResponse = await htmlExtracts.session.actions.execute('/get_watch', {
      playerRequest: createPlayerRequestBody(id, player.signature_timestamp, contentPoToken),
      watchNextRequest: createWatchNextRequestBody(id)
    })

    playerResponse = {
      data: combinedResponse.data.find(response => {
        return response.responseType === 'STREAMING_WATCH_RESPONSE_TYPE_PLAYER_RESPONSE'
      }).playerResponse
    }

    nextResponse = {
      data: combinedResponse.data.find(response => {
        return response.responseType === 'STREAMING_WATCH_RESPONSE_TYPE_WATCH_NEXT_RESPONSE'
      }).watchNextResponse
    }
  } else {
    if (htmlExtracts.playerResponse) {
      totalAdTimeMilliseconds = extractTotalAdTimeMilliseconds(htmlExtracts.playerResponse)

      playerResponse = { data: htmlExtracts.playerResponse }
    } else {
      const requestBody = createPlayerRequestBody(id, player.signature_timestamp, contentPoToken)
      playerResponse = await htmlExtracts.session.actions.execute('/player', requestBody)
    }

    if (htmlExtracts.nextResponse) {
      nextResponse = { data: htmlExtracts.nextResponse }
    } else {
      const requestBody = createWatchNextRequestBody(id)
      nextResponse = await htmlExtracts.session.actions.execute('/next', requestBody)
    }
  }

  if (
    playerResponse?.data &&
    (playerResponse.data.videoDetails?.isLive ||
    playerResponse.data.videoDetails?.isPostLiveDvr) &&
    !playerResponse.data.videoDetails?.isUpcoming &&
    !playerResponse.data.streamingData?.hlsManifestUrl
  ) {
    const mwebRequestBody = createPlayerRequestBody(id, player.signature_timestamp, contentPoToken, 'MWEB')

    const fields = 'streamingData,playabilityStatus,adSlots'
    const mwebPlayerResponse = await htmlExtracts.session.actions.execute(`/player?$fields=${fields}`, mwebRequestBody)

    Object.assign(playerResponse.data, mwebPlayerResponse.data)
  }

  const cpn = Utils.generateRandomString(16)

  const info = new YT.VideoInfo([playerResponse, nextResponse], htmlExtracts.session.actions, cpn)

  // Some time would be used for parsing and maybe additional requests so end time should be calculated sooner to reduce actual waiting time
  // Legacy format requires this
  const adEndTimeUnixMs = responseTime + totalAdTimeMilliseconds

  let { clientName, clientVersion, osName, osVersion } = context.client

  let hasTrailer = info.has_trailer
  let trailerIsAgeRestricted = info.getTrailerInfo() === null

  if (
    ((info.playability_status.status === 'UNPLAYABLE' || info.playability_status.status === 'LOGIN_REQUIRED') &&
      info.playability_status.reason === 'Sign in to confirm your age') ||
    (hasTrailer && trailerIsAgeRestricted)
  ) {
    try {
      const webEmbeddedInnertube = await createInnertube({ clientType: ClientType.WEB_EMBEDDED })
      webEmbeddedInnertube.session.context.client.visitorData = context.client.visitorData

      const videoId = hasTrailer && trailerIsAgeRestricted ? info.playability_status.error_screen.video_id : id

      // getBasicInfo needs the signature timestamp (sts) from inside the player
      webEmbeddedInnertube.session.player = player

      const bypassedInfo = await webEmbeddedInnertube.getBasicInfo(videoId, { client: 'WEB_EMBEDDED', po_token: contentPoToken })

      if (bypassedInfo.playability_status.status === 'OK' && bypassedInfo.streaming_data) {
        info.playability_status = bypassedInfo.playability_status
        info.streaming_data = bypassedInfo.streaming_data
        info.basic_info.start_timestamp = bypassedInfo.basic_info.start_timestamp
        info.basic_info.duration = bypassedInfo.basic_info.duration
        info.captions = bypassedInfo.captions
        info.storyboards = bypassedInfo.storyboards

        hasTrailer = false
        trailerIsAgeRestricted = false;

        ({ clientName, clientVersion, osName, osVersion } = webEmbeddedInnertube.session.context.client)
      }
    } catch (error) {
      console.warn('WEB_EMBEDDED fallback errored, using the original response instead', error)
    }
  }

  const clientInfo = {
    clientName: Constants.CLIENT_NAME_IDS[clientName],
    clientVersion,
    osName,
    osVersion
  }

  if ((info.playability_status.status === 'UNPLAYABLE' && (!hasTrailer || trailerIsAgeRestricted)) ||
    info.playability_status.status === 'LOGIN_REQUIRED') {
    return { info, poToken: undefined, clientInfo, contentDisclosures: extractLocalContentDisclosures(info) }
  }

  if (hasTrailer && info.playability_status.status !== 'OK') {
    const trailerInfo = info.getTrailerInfo()

    // don't override the timestamp of when the video will premiere for upcoming videos
    if (info.playability_status.status !== 'LIVE_STREAM_OFFLINE') {
      info.basic_info.start_timestamp = trailerInfo.basic_info.start_timestamp
    }

    info.playability_status = trailerInfo.playability_status
    info.streaming_data = trailerInfo.streaming_data
    info.basic_info.duration = trailerInfo.basic_info.duration
    info.captions = trailerInfo.captions
    info.storyboards = trailerInfo.storyboards
  }

  if (info.streaming_data) {
    await decipherFormats(info.streaming_data.formats, player)

    if (info.streaming_data.server_abr_streaming_url) {
      info.streaming_data.server_abr_streaming_url = await player.decipher(info.streaming_data.server_abr_streaming_url)
    }

    if (info.streaming_data.dash_manifest_url) {
      info.streaming_data.dash_manifest_url = await decipherManifestUrl(
        info.streaming_data.dash_manifest_url,
        player,
        contentPoToken,
        true
      )
    }

    if (info.streaming_data.hls_manifest_url) {
      info.streaming_data.hls_manifest_url = await decipherManifestUrl(
        info.streaming_data.hls_manifest_url,
        player,
        contentPoToken,
        false
      )
    }
  }

  if (info.captions?.caption_tracks) {
    for (const captionTrack of info.captions.caption_tracks) {
      const url = new URL(captionTrack.base_url)

      url.searchParams.set('potc', '1')
      url.searchParams.set('pot', contentPoToken)
      url.searchParams.set('c', clientName)

      // Remove &xosf=1 as it adds `position:63% line:0%` to the subtitle lines
      // placing them in the top right corner
      url.searchParams.delete('xosf')

      captionTrack.base_url = url.toString()
    }
  }

  return {
    info,
    poToken: contentPoToken,
    clientInfo,
    adEndTimeUnixMs,
    contentDisclosures: extractLocalContentDisclosures(info),
  }
}

/**
 * Extracts content disclosures ('How this was made') from YouTube VideoInfo response
 * @param {import('youtubei.js').YT.VideoInfo} info
 * @returns {{ label: string, description: string, attribution: string }[] | null}
 */
export function extractLocalContentDisclosures(info) {
  if (info?.page?.[1]?.engagement_panels) {
    const structuredDescPanel = info.page[1].engagement_panels.find(
      panel => panel.target_id === 'engagement-panel-structured-description'
    )

    if (structuredDescPanel?.content?.is(YTNodes.StructuredDescriptionContent)) {
      const LEARN_MORE_REGEX = /\s*Learn more\.?$/i

      const items = structuredDescPanel.content.items
        .filterType(YTNodes.HowThisWasMadeSectionView)
        .map(item => ({
          label: item.body_header?.text ?? '',
          description: item.body_text?.text?.replace(LEARN_MORE_REGEX, '').trim() ?? '',
          attribution: item.attribution_text?.text ?? '',
        }))

      return items.length > 0 ? items : null
    }
  }

  return null
}

/**
 * @type {object}
 */
function extractTotalAdTimeMilliseconds(json) {
  let totalAdTimeMilliseconds = 0

  if (Array.isArray(json.adSlots)) {
    for (const adSlot of json.adSlots) {
      if (adSlot.adSlotRenderer?.adSlotMetadata?.triggerEvent === 'SLOT_TRIGGER_EVENT_BEFORE_CONTENT') {
        const instreamVideoAdRenderer = adSlot.adSlotRenderer.fulfillmentContent?.fulfilledLayout?.playerBytesAdLayoutRenderer
          ?.renderingContent?.instreamVideoAdRenderer

        if (instreamVideoAdRenderer) {
          if (typeof instreamVideoAdRenderer.skipOffsetMilliseconds === 'number') {
            totalAdTimeMilliseconds += instreamVideoAdRenderer.skipOffsetMilliseconds
          } else if (instreamVideoAdRenderer.playerVars) {
            const match = instreamVideoAdRenderer.playerVars.match(/length_seconds=([\d.]+)/)

            if (match) {
              totalAdTimeMilliseconds += parseFloat(match[1]) * 1000
            }
          }
        }
      }
    }
  }

  return totalAdTimeMilliseconds
}

/**
 * @param {string} id
 */
export async function getLocalComments(id) {
  const innertube = await createInnertube({ generateSessionLocally: false })
  return innertube.getComments(id)
}

// I know `type & type` is typescript syntax and not valid jsdoc but I couldn't get @extends or @augments to work

/**
 * @typedef {object} _LocalFormat
 * @property {string} freeTubeUrl deciphered streaming URL, stored in a custom property so the DASH manifest generation doesn't break
 *
 * @typedef {Misc.Format & _LocalFormat} LocalFormat
 */

/**
 * @param {Misc.Format[]} formats
 * @param {import('youtubei.js').Player} player
 */
async function decipherFormats(formats, player) {
  for (const format of formats) {
    // toDash deciphers the format again, so if we overwrite the original URL,
    // it breaks because the n param would get deciphered twice and then be incorrect
    format.freeTubeUrl = await format.decipher(player)
  }
}

/**
 * @param {string} url
 * @param {import('youtubei.js').Player} player
 * @param {string} poToken
 * @param {boolean} isDash
 */
async function decipherManifestUrl(url, player, poToken, isDash) {
  const urlObject = new URL(url)

  if (urlObject.searchParams.size > 0) {
    urlObject.searchParams.set('pot', poToken)

    if (isDash) {
      urlObject.searchParams.set('mpd_version', '7')
    }

    return await player.decipher(urlObject.toString())
  }

  const pathPrefix = isDash ? '/api/manifest/dash' : '/api/manifest/hls_variant'

  // Convert path params to query params
  const pathParts = urlObject.pathname
    .replace(pathPrefix, '')
    .split('/')
    .filter(part => part.length > 0)

  urlObject.pathname = pathPrefix

  for (let i = 0; i + 1 < pathParts.length; i += 2) {
    urlObject.searchParams.set(pathParts[i], decodeURIComponent(pathParts[i + 1]))
  }

  // decipher
  const deciphered = await player.decipher(urlObject.toString())

  // convert query parameters back to path parameters
  const decipheredUrlObject = new URL(deciphered)

  for (const [key, value] of decipheredUrlObject.searchParams) {
    decipheredUrlObject.pathname += `/${key}/${encodeURIComponent(value)}`
  }

  decipheredUrlObject.search = ''
  decipheredUrlObject.pathname += `/pot/${encodeURIComponent(poToken)}`

  if (isDash) {
    decipheredUrlObject.pathname += '/mpd_version/7'
  }

  return decipheredUrlObject.toString()
}

/**
 * @param {string} url
 * @param {boolean} doLogError
 */
export async function getLocalChannelId(url, doLogError = false) {
  try {
    const innertube = await createInnertube()

    // Resolve URL and allow 1 redirect, as YouTube should just do 1
    // We want to avoid an endless loop
    for (let i = 0; i < 2; i++) {
      // resolveURL throws an error if the URL doesn't exist
      const navigationEndpoint = await innertube.resolveURL(url)

      if (navigationEndpoint.metadata.page_type === 'WEB_PAGE_TYPE_CHANNEL') {
        return navigationEndpoint.payload.browseId
      } else if (navigationEndpoint.metadata.page_type === 'WEB_PAGE_TYPE_UNKNOWN' && navigationEndpoint.payload.url?.startsWith('https://www.youtube.com/')) {
        // handle redirects like https://www.youtube.com/@wanderbots, which resolves to https://www.youtube.com/Wanderbots, which we need to resolve again
        url = navigationEndpoint.payload.url
      } else if (navigationEndpoint.payload.browseId === 'FEpost_detail') {
        // convert base64 params to string and get the channelid
        return atob(navigationEndpoint.payload.params).replaceAll(/[^\d\sA-Za-z-]/g, ' ').trim().split(' ').at(-1)
      }
    }
  } catch (e) {
    if (doLogError) {
      console.error(e)
    }
  }

  return null
}

/**
 * Returns the channel or the channel termination reason
 * @param {string} id
 */
export async function getLocalChannel(id) {
  const innertube = await createInnertube()
  let result
  try {
    result = await innertube.getChannel(id)
  } catch (error) {
    if (error instanceof Utils.ChannelError) {
      result = {
        alert: error.message
      }
    } else {
      throw error
    }
  }
  return result
}

/**
 * @param {string} id
 */
export async function getLocalChannelVideos(id) {
  const session = await createSession()

  try {
    const response = await session.actions.execute('/browse', {
      browseId: id,
      params: 'EgZ2aWRlb3PyBgQKAjoA'
      // protobuf for the videos tab (this is the one that YouTube uses,
      // it has some empty fields in the protobuf but it doesn't work if you remove them)
    })

    const videosTab = new YT.Channel(session.actions, response)
    const { id: channelId = id, name, thumbnailUrl } = parseLocalChannelHeader(videosTab, true)

    let videos

    // if the channel doesn't have a videos tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (videosTab.current_tab?.endpoint.metadata.url?.endsWith('/videos')) {
      videos = parseLocalChannelVideos(videosTab.videos, channelId, name)
    } else if (name.endsWith('- Topic') && !!videosTab.metadata.music_artist_name) {
      try {
        const innertube = new Innertube(session)
        const playlist = await innertube.getPlaylist(getChannelPlaylistId(channelId, 'videos', 'newest'))

        videos = parseLocalPlaylistVideos(playlist.items)
      } catch (error) {
        // If the channel doesn't exist, the API call to channel page above would have already failed,
        // so if we get an error that the playlist doesn't exist here, it just means that this artist topic channel
        // doesn't have any videos.
        if (error.message === 'The playlist does not exist.') {
          videos = []
        } else {
          throw error
        }
      }
    } else {
      videos = []
    }

    return {
      name,
      thumbnailUrl,
      videos
    }
  } catch (error) {
    console.error(error)
    if (error instanceof Utils.ChannelError) {
      return null
    } else {
      throw error
    }
  }
}

/**
 * @param {string} id
 */
export async function getLocalChannelLiveStreams(id) {
  const session = await createSession()

  try {
    const response = await session.actions.execute('/browse', {
      browseId: id,
      params: 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D'
      // protobuf for the live tab (this is the one that YouTube uses,
      // it has some empty fields in the protobuf but it doesn't work if you remove them)
    })

    let liveStreamsTab = new YT.Channel(session.actions, response)
    const { id: channelId = id, name, thumbnailUrl } = parseLocalChannelHeader(liveStreamsTab, true)

    let videos

    // if the channel doesn't have a live tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (liveStreamsTab.current_tab?.endpoint.metadata.url?.endsWith('/streams')) {
      // work around YouTube bug where it will return a bunch of responses with only continuations in them
      // e.g. https://www.youtube.com/@TWLIVES/streams

      let tempVideos = liveStreamsTab.videos
      while (tempVideos.length === 0 && liveStreamsTab.has_continuation) {
        liveStreamsTab = await liveStreamsTab.getContinuation()
        tempVideos = liveStreamsTab.videos
      }

      videos = parseLocalChannelVideos(tempVideos, channelId, name)
    } else {
      videos = []
    }

    return {
      name,
      thumbnailUrl,
      videos
    }
  } catch (error) {
    console.error(error)
    if (error instanceof Utils.ChannelError) {
      return null
    } else {
      throw error
    }
  }
}

export async function getLocalChannelCommunity(id) {
  const session = await createSession()

  try {
    const response = await session.actions.execute('/browse', {
      browseId: id,
      params: 'EgVwb3N0c_IGBAoCSgA%3D'
      // protobuf for the community tab (this is the one that YouTube uses,
      // it has some empty fields in the protobuf but it doesn't work if you remove them)
    })

    const communityTab = new YT.Channel(session.actions, response)

    // if the channel doesn't have a community tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (communityTab.current_tab?.endpoint.metadata.url?.endsWith('/posts')) {
      return parseLocalCommunityPosts(communityTab.posts)
    } else {
      return []
    }
  } catch (error) {
    console.error(error)
    if (error instanceof Utils.ChannelError) {
      return null
    } else {
      throw error
    }
  }
}

/**
 * @param {YT.Channel} channel
 */
export async function getLocalArtistTopicChannelReleases(channel) {
  const rawEngagementPanel = channel.shelves[0]?.menu?.top_level_buttons?.[0]?.endpoint.payload?.engagementPanel

  if (!rawEngagementPanel) {
    return {
      releases: channel.playlists.map(playlist => parseLocalListPlaylist(playlist)),
      continuationData: null
    }
  }

  /** @type {import('youtubei.js').YTNodes.EngagementPanelSectionList} */
  const engagementPanelSectionList = Parser.parseItem(rawEngagementPanel)

  /** @type {import('youtubei.js').YTNodes.ContinuationItem|undefined} */
  const continuationItem = engagementPanelSectionList?.content?.contents?.[0]?.contents?.[0]

  if (!continuationItem) {
    return {
      releases: channel.playlists.map(playlist => parseLocalListPlaylist(playlist)),
      continuationData: null
    }
  }

  return await getLocalArtistTopicChannelReleasesContinuation(channel, continuationItem)
}

/**
 * @param {YT.Channel} channel
 * @param {import('youtubei.js').YTNodes.ContinuationItem} continuationData
 */
export async function getLocalArtistTopicChannelReleasesContinuation(channel, continuationData) {
  const response = await continuationData.endpoint.call(channel.actions, { parse: true })

  const memo = response.on_response_received_endpoints_memo

  const playlists = memo.get('GridPlaylist') ?? memo.get('LockupView') ?? memo.get('Playlist')

  /** @type {import('youtubei.js').YTNodes.ContinuationItem | null} */
  const continuationItem = memo.get('ContinuationItem')?.[0] ?? null

  return {
    releases: playlists ? playlists.map(playlist => parseLocalListPlaylist(playlist)) : [],
    continuationData: continuationItem
  }
}

/**
 * @param {import('youtubei.js').YTNodes.NavigationEndpoint} endpoint
 * @returns {string|null}
 */
function getDirectChannelAboutUrl(endpoint) {
  try {
    let url = new URL(endpoint.toURL())

    const redirectTarget = getYouTubeRedirectTarget(url)
    if (redirectTarget !== undefined) {
      if (!redirectTarget) return null
      const destination = SCHEMELESS_DOMAIN_URL_PATTERN.test(redirectTarget)
        ? `https://${redirectTarget.replace(/^\/\//, '')}`
        : redirectTarget
      url = new URL(destination)
    }

    return ALLOWED_LINK_PROTOCOLS.includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/**
 * @param {import('youtubei.js').YTNodes.ChannelAboutFullMetadata | import('youtubei.js').YTNodes.AboutChannel} about
 * @returns {{ title: string, url: string, displayUrl: string, iconUrl: string }[]}
 */
export function parseLocalChannelAboutLinks(about) {
  const links = about.primary_links ?? about.metadata?.links ?? []
  const parsedLinks = []

  for (const link of links) {
    const endpoint = link.endpoint ?? link.link.endpoint
    const url = getDirectChannelAboutUrl(endpoint)

    if (!url) {
      continue
    }

    const icons = link.icon ?? link.favicon ?? []

    parsedLinks.push({
      title: link.title.text?.trim() ?? '',
      url,
      displayUrl: url.replace(/^https?:\/\/(?:www\.)?/, ''),
      iconUrl: icons[0]?.url ?? ''
    })
  }

  return parsedLinks
}

/**
 * @param {YT.Channel} channel
 * @param {boolean} onlyIdNameThumbnail
 */
export function parseLocalChannelHeader(channel, onlyIdNameThumbnail = false) {
  /** @type {string?} */
  let id
  /** @type {string} */
  let name
  /** @type {string?} */
  let thumbnailUrl
  /** @type {string?} */
  let bannerUrl
  /** @type {string?} */
  let subscriberText
  /** @type {string[]} */
  const tags = []

  switch (channel.header.type) {
    case 'C4TabbedHeader': {
      // example: Linus Tech Tips
      // https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw

      /**
       * @type {import('youtubei.js').YTNodes.C4TabbedHeader}
       */
      const header = channel.header

      id = header.author.id
      name = header.author.name
      thumbnailUrl = header.author.best_thumbnail.url

      if (!onlyIdNameThumbnail) {
        bannerUrl = header.banner?.[0]?.url
        subscriberText = header.subscribers?.text
      }
      break
    }
    case 'CarouselHeader': {
      // examples: Music and YouTube Gaming
      // https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ
      // https://www.youtube.com/channel/UCOpNcN46UbXVtpKMrmU4Abg

      /**
       * @type {import('youtubei.js').YTNodes.CarouselHeader}
       */
      const header = channel.header

      /**
       * @type {import('youtubei.js').YTNodes.TopicChannelDetails}
       */
      const topicChannelDetails = header.contents.find(node => node.type === 'TopicChannelDetails')
      name = topicChannelDetails.title.text
      thumbnailUrl = topicChannelDetails.avatar[0].url

      if (channel.metadata.external_id) {
        id = channel.metadata.external_id
      } else {
        id = topicChannelDetails.subscribe_button.channel_id
      }

      if (!onlyIdNameThumbnail) {
        subscriberText = topicChannelDetails.subtitle.text
      }
      break
    }
    case 'InteractiveTabbedHeader': {
      // example: Minecraft - Topic
      // https://www.youtube.com/channel/UCQvWX73GQygcwXOTSf_VDVg

      /**
       * @type {import('youtubei.js').YTNodes.InteractiveTabbedHeader}
       */
      const header = channel.header
      name = header.title.text
      thumbnailUrl = header.box_art.at(-1).url
      id = channel.current_tab?.endpoint.payload.browseId

      if (!onlyIdNameThumbnail) {
        bannerUrl = header.banner[0]?.url

        const badges = header.badges.map(badge => badge.label).filter(tag => tag)
        tags.push(...badges)
      }
      break
    }
    case 'PageHeader': {
      // example: YouTube Gaming
      // https://www.youtube.com/channel/UCOpNcN46UbXVtpKMrmU4Abg

      // User channels (an A/B test at the time of writing)

      /**
       * @type {import('youtubei.js').YTNodes.PageHeader}
       */
      const header = channel.header

      name = header.content.title.text.text
      if (header.content.image) {
        if (header.content.image.type === 'ContentPreviewImageView') {
          /** @type {import('youtubei.js').YTNodes.ContentPreviewImageView} */
          const image = header.content.image

          thumbnailUrl = image.image[0].url
        } else {
          /** @type {import('youtubei.js').YTNodes.DecoratedAvatarView} */
          const image = header.content.image
          thumbnailUrl = image.avatar?.image[0].url
        }
      } else if (header.content.animated_image) {
        thumbnailUrl = header.content.animated_image.image[0].url
      }

      if (!thumbnailUrl && channel.metadata.thumbnail) {
        thumbnailUrl = channel.metadata.thumbnail[0].url
      }

      if (!onlyIdNameThumbnail && header.content.banner) {
        bannerUrl = header.content.banner.image[0]?.url
      }

      if (header.content.actions) {
        const modal = header.content.actions.actions_rows[0].actions[0].on_tap.modal

        if (modal && modal.type === 'ModalWithTitleAndButton') {
          /** @type {import('youtubei.js').YTNodes.ModalWithTitleAndButton} */
          const typedModal = modal

          id = typedModal.button.endpoint.next_endpoint?.payload.browseId
        }
      } else if (channel.metadata.external_id) {
        id = channel.metadata.external_id
      }

      if (!onlyIdNameThumbnail && header.content.metadata) {
        // YouTube has already changed the indexes for where the information is stored once,
        // so we should search for it instead of using hardcoded indexes, just to be safe for the future

        subscriberText = header.content.metadata.metadata_rows
          .flatMap(row => row.metadata_parts ? row.metadata_parts : [])
          .find(part => part.text?.text?.includes('subscriber'))
          ?.text?.text
      }

      break
    }
  }

  if (onlyIdNameThumbnail) {
    return {
      id,
      name,
      thumbnailUrl
    }
  }

  return {
    id,
    name,
    thumbnailUrl,
    bannerUrl,
    subscriberText,
    tags
  }
}

/**
 * @param {import('youtubei.js').YTNodes.Video[]} videos
 * @param {string} channelId
 * @param {string} channelName
 */
export function parseLocalChannelVideos(videos, channelId, channelName) {
  const parsedVideos = []

  for (const video of videos) {
    const parsedVideo = parseLocalListVideo(video, channelId, channelName)
    if (parsedVideo != null) {
      parsedVideos.push(parsedVideo)
    }
  }

  return parsedVideos
}

/**
 * @param {YTNodes.ReelItem | YTNodes.ShortsLockupView} short
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
export function parseShort(short, channelId, channelName) {
  if (short.type === 'ReelItem') {
    /** @type {import('youtubei.js').YTNodes.ReelItem} */
    const reelItem = short

    return {
      type: 'video',
      videoId: reelItem.id,
      title: reelItem.title.text?.trim(),
      author: channelName,
      authorId: channelId,
      viewCount: reelItem.views.isEmpty() ? null : parseLocalSubscriberCount(reelItem.views.text),
      lengthSeconds: ''
    }
  } else {
    /** @type {import('youtubei.js').YTNodes.ShortsLockupView} */
    const shortsLockupView = short

    return {
      type: 'video',
      videoId: shortsLockupView.on_tap_endpoint.payload.videoId,
      title: shortsLockupView.overlay_metadata.primary_text.text?.trim(),
      author: channelName,
      authorId: channelId,
      viewCount: shortsLockupView.overlay_metadata.secondary_text ? parseLocalSubscriberCount(shortsLockupView.overlay_metadata.secondary_text.text) : null,
      lengthSeconds: ''
    }
  }
}

/**
 * @param {(import('youtubei.js').YTNodes.ReelItem | import('youtubei.js').YTNodes.ShortsLockupView)[]} shorts
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
export function parseLocalChannelShorts(shorts, channelId, channelName) {
  return shorts.map(short => parseShort(short, channelId, channelName))
}

/**
 * @param {import('youtubei.js').YTNodes.Playlist|import('youtubei.js').YTNodes.GridPlaylist|import('youtubei.js').YTNodes.LockupView} playlist
 * @param {string} channelId
 * @param {string} channelName
 */
export function parseLocalListPlaylist(playlist, channelId = undefined, channelName = undefined) {
  if (playlist.type === 'LockupView') {
    return parseLockupView(playlist, channelId, channelName)
  } else if (playlist.type === 'CompactStation') {
    /** @type {import('youtubei.js').YTNodes.CompactStation} */
    const compactStation = playlist

    return {
      type: 'playlist',
      dataSource: 'local',
      title: compactStation.title.text,
      thumbnail: compactStation.thumbnail[1].url,
      playlistId: compactStation.endpoint.payload.playlistId,
      videoCount: extractNumberFromString(compactStation.video_count.text)
    }
  } else if (playlist.type === 'GridPlaylist') {
    /** @type {import('youtubei.js').YTNodes.GridPlaylist} */
    const gridPlaylist = playlist
    const isAlbum = playlist.thumbnail_overlays?.some(overlay => overlay.icon_type === 'MUSIC') ?? false

    return {
      type: 'playlist',
      dataSource: 'local',
      title: gridPlaylist.title.text,
      thumbnail: gridPlaylist.thumbnails.at(0).url,
      playlistId: gridPlaylist.id,
      channelName: gridPlaylist.author?.name,
      channelId: gridPlaylist.author?.id,
      videoCount: extractNumberFromString(gridPlaylist.video_count.text),
      isAlbum,
    }
  } else if (playlist.type === 'GridShow') {
    /** @type {import('youtubei.js').YTNodes.GridShow} */
    const gridPlaylist = playlist

    return {
      type: 'playlist',
      dataSource: 'local',
      title: gridPlaylist.title.text,
      thumbnail: gridPlaylist.thumbnail_renderer.thumbnail.at(0).url,
      playlistId: gridPlaylist.endpoint.payload.browseId.substring(2),
      channelName: gridPlaylist.author?.name,
      channelId: gridPlaylist.author?.id,
      isShow: true,
      videoCount: extractNumberFromString(gridPlaylist.thumbnail_overlays?.at(0).text.runs?.at(0)?.text)
    }
  } else {
    let internalChannelName
    let internalChannelId = null

    if (playlist.author && (playlist.author.id !== 'N/A' && playlist.author.name !== 'N/A')) {
      if (playlist.author instanceof Misc.Text) {
        internalChannelName = playlist.author.text

        if (channelId) {
          internalChannelId = channelId
        }
      } else {
        internalChannelName = playlist.author.name
        internalChannelId = playlist.author.id
      }
    } else if (channelId || channelName) {
      internalChannelName = channelName
      internalChannelId = channelId
    } else if (playlist.author?.name) {
      // auto-generated album playlists don't have an author
      // so in search results, the author text is "Playlist" and doesn't have a link or channel ID
      internalChannelName = playlist.author.name
    }

    /** @type {import('youtubei.js').YTNodes.PlaylistVideoThumbnail} */
    const thumbnailRenderer = playlist.thumbnail_renderer
    const isCourse = playlist.thumbnail_overlays.some(overlay => overlay.icon_type === 'COURSE')
    const isAlbum = playlist.thumbnail_overlays.some(overlay => overlay.icon_type === 'MUSIC')
    return {
      type: 'playlist',
      dataSource: 'local',
      title: playlist.title.text,
      thumbnail: thumbnailRenderer ? thumbnailRenderer.thumbnail[0].url : playlist.thumbnails[0].url,
      channelName: internalChannelName,
      channelId: internalChannelId,
      playlistId: playlist.id,
      videoCount: extractNumberFromString(playlist.video_count.text),
      isCourse,
      isAlbum,
    }
  }
}

/**
 * @param {YT.Search} response
 */
function handleSearchResponse(response) {
  if (!response.results) {
    return {
      results: [],
      continuationData: null,
      validResultsCount: 0,
    }
  }

  const resultsWithValidTypes = response.results
    .filter((item) => {
      return item.type === 'Video' || item.type === 'Channel' || item.type === 'Playlist' || item.type === 'HashtagTile' || item.type === 'Movie' || item.type === 'LockupView'
    })
  const validResultsCount = resultsWithValidTypes.length
  const results = resultsWithValidTypes
    .map((item) => parseListItem(item))
    .filter((item) => item)

  return {
    results,
    // check the length of the results, as there can be continuations for things that we've filtered out, which we don't want
    continuationData: response.has_continuation && results.length > 0 ? response : null,
    validResultsCount,
  }
}

/**
 * @param {import('youtubei.js').YT.Channel} homeTab
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
export function parseChannelHomeTab(homeTab, channelId, channelName) {
  /**
   * @type {import('youtubei.js').YTNodes.ItemSection | import('youtubei.js').YTNodes.RichSection}
   */
  let section
  const shelves = []
  for (section of homeTab.current_tab.content.contents) {
    if (section.type === 'ItemSection') {
      /**
       * @type {import('youtubei.js').YTNodes.ItemSection}
       */
      const itemSection = section
      if (itemSection.contents.at(0).type === 'Shelf') {
        /** @type {import('youtubei.js').YTNodes.Shelf} */
        const shelf = itemSection.contents.at(0)

        const playlistId = shelf.play_all_button?.endpoint.payload.playlistId

        // filter out the members-only video section as none of the videos in that section are playable as they require a paid channel membership
        if (!playlistId || !playlistId.startsWith('UUMO')) {
          shelves.push({
            title: shelf.title.text,
            content: shelf.content.items.map((item) => parseListItem(item, channelId, channelName)).filter(_ => _),
            playlistId,
            subtitle: shelf.subtitle?.text
          })
        }
      } else if (itemSection.contents.at(0).type === 'ReelShelf') {
        /** @type {import('youtubei.js').YTNodes.ReelShelf} */
        const shelf = itemSection.contents.at(0)
        shelves.push({
          title: shelf.title.text,
          content: shelf.items.map((item) => parseListItem(item, channelId, channelName)).filter(_ => _)
        })
      } else if (itemSection.contents.at(0).type === 'HorizontalCardList') {
        /** @type {import('youtubei.js').YTNodes.HorizontalCardList} */
        const shelf = itemSection.contents.at(0)
        shelves.push({
          title: shelf.header.title.text,
          content: shelf.cards.map((item) => parseListItem(item, channelId, channelName)).filter(_ => _),
          subtitle: shelf.header.subtitle.text
        })
      }
    } else if (section.type === 'RichSection') {
      if (section.content.type === 'RichShelf') {
        /** @type {import('youtubei.js').YTNodes.RichShelf} */
        const shelf = section.content
        shelves.push({
          title: shelf.title?.text,
          content: shelf.contents.map(e => parseListItem(e.content, channelId, channelName)).filter(_ => _),
          subtitle: shelf.subtitle?.text,
          playlistId: shelf.endpoint?.metadata.url.includes('/playlist') ? shelf.endpoint?.metadata.url.replace('/playlist?list=', '') : null
        })
      }
    }
  }

  shelves.forEach(e => {
    e['isCommunity'] = e.content.at(0)?.type === 'community'
  })
  return shelves
}
/**
 * @param {import('youtubei.js').YTNodes.PlaylistVideo|import('youtubei.js').YTNodes.ReelItem|import('youtubei.js').YTNodes.LockupView|import('youtubei.js').YTNodes.ShortsLockupView} video
 */
function parsePlaylistVideo(video) {
  if (video.type === 'ReelItem') {
    /** @type {import('youtubei.js').YTNodes.ReelItem} */
    const short = video

    return {
      type: 'video',
      videoId: short.id,
      title: short.title.text?.trim(),
      viewCount: parseLocalSubscriberCount(short.views.text),
      lengthSeconds: ''
    }
  } else if (video.type === 'ShortsLockupView') {
    /** @type {import('youtubei.js').YTNodes.ShortsLockupView} */
    const shortsLockupView = video

    let viewCount = null

    // the accessiblity text is the only place with the view count
    if (shortsLockupView.accessibility_text) {
      // the `.*\s+` at the start of the regex, ensures we match the last occurence
      // just in case the video title also contains that pattern
      const match = shortsLockupView.accessibility_text.match(/.*\s+(\d+(?:[,.]\d+)?\s?(?:[BKMbkm]|thousand|[bm]illion)?|no)\s+views?/)

      if (match) {
        const count = match[1]

        // as it's rare that a video has no views,
        // checking the length allows us to avoid running toLowerCase unless we have to
        if (count.length === 2 && count === 'no') {
          viewCount = 0
        } else {
          const views = parseLocalSubscriberCount(count)

          if (!isNaN(views)) {
            viewCount = views
          }
        }
      }
    }

    return {
      type: 'video',
      videoId: shortsLockupView.on_tap_endpoint.payload.videoId,
      title: shortsLockupView.overlay_metadata.primary_text.text?.trim(),
      viewCount,
      lengthSeconds: ''
    }
  } else if (video.type === 'LockupView') {
    return parseLockupView(video)
  } else {
    /** @type {import('youtubei.js').YTNodes.PlaylistVideo} */
    const video_ = video

    let viewCount = null

    const viewsText = video_.video_info.runs?.find(run => isViewCountText(run.text))?.text

    if (viewsText) {
      const views = parseLocalSubscriberCount(viewsText)
      if (!isNaN(views)) {
        viewCount = views
      }
    }

    let publishedText
    // normal videos have 3 text runs with the last one containing the published date
    // OR no runs and just text with the published date (if the view count is missing)
    // live videos have 2 text runs with the number of people watching
    // upcoming either videos don't have any info text or the number of people waiting,
    // but we have the premiere date for those, so we don't need the published date

    if (!video_.is_upcoming && !video_.is_live) {
      const hasRuns = !!video_.video_info.runs

      if (hasRuns && video_.video_info.runs.length === 3) {
        publishedText = video_.video_info.runs[2].text
      } else if (!hasRuns && video_.video_info.text) {
        publishedText = video_.video_info.text
      }
    }

    const published = calculatePublishedDate(
      publishedText,
      video_.is_live,
      video_.is_upcoming,
      video_.upcoming
    )

    return {
      type: 'video',
      videoId: video_.id,
      title: video_.title.text?.trim(),
      author: video_.author.name,
      authorId: (video_.author?.id != null && video_.author.id !== 'N/A') ? video_.author.id : null,
      viewCount,
      published,
      lengthSeconds: isNaN(video_.duration.seconds) ? '' : video_.duration.seconds,
      liveNow: video_.is_live,
      isUpcoming: video_.is_upcoming,
      premiereDate: video_.upcoming
    }
  }
}

/**
 * @param {(import('youtubei.js').YTNodes.PlaylistVideo|import('youtubei.js').YTNodes.ReelItem|import('youtubei.js').YTNodes.LockupView|import('youtubei.js').YTNodes.ShortsLockupView)[]} videos
 */
export function parseLocalPlaylistVideos(videos) {
  const parsedVideos = []

  for (const video of videos) {
    const parsedVideo = parsePlaylistVideo(video)
    if (parsedVideo != null) {
      parsedVideos.push(parsedVideo)
    }
  }

  return parsedVideos
}

/**
 * @param {import('youtubei.js').YTNodes.Video | import('youtubei.js').YTNodes.Movie} item
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
export function parseLocalListVideo(item, channelId, channelName) {
  if (item.type === 'Movie') {
    /** @type {import('youtubei.js').YTNodes.Movie} */
    const movie = item

    return {
      type: 'video',
      videoId: movie.id,
      title: movie.title.text?.trim(),
      author: movie.author.name !== 'N/A' ? movie.author.name : channelName,
      authorId: movie.author.id !== 'N/A' ? movie.author.id : channelId,
      description: movie.description_snippet?.text,
      lengthSeconds: isNaN(movie.duration.seconds) ? '' : movie.duration.seconds,
      liveNow: false,
      isUpcoming: false,
    }
  } else if (item.type === 'GridVideo') {
    /** @type {import('youtubei.js').YTNodes.GridVideo} */
    const video = item

    // This can happen for unavailable clip on channel home page
    if (!video.video_id) {
      return null
    }

    let publishedText

    if (video.published != null && !video.published.isEmpty()) {
      publishedText = video.published.text
    }

    const isLive = video.duration?.text === 'LIVE'

    const published = calculatePublishedDate(
      publishedText,
      video.is_live,
      video.is_upcoming || video.is_premiere,
      video.upcoming
    )

    return {
      type: 'video',
      videoId: video.video_id,
      title: video.title.text?.trim(),
      author: video.author?.name ?? channelName,
      authorId: (video.author?.id != null && video.author.id !== 'N/A') ? video.author.id : channelId,
      collaborators: video.author == null ? [] : parseLocalCollaborators(video.author.collaborators),
      viewCount: video.views.text == null ? null : extractNumberFromString(video.views.text),
      published,
      lengthSeconds: isLive || video.duration == null ? '' : Utils.timeToSeconds(video.duration.text),
      isUpcoming: video.is_upcoming,
      premiereDate: video.upcoming,
      liveNow: isLive
    }
  } else if (item.type === 'GridMovie') {
    /** @type {import('youtubei.js').YTNodes.GridMovie} */
    const movie = item
    return {
      type: 'video',
      videoId: movie.id,
      title: movie.title.text,
      author: movie.author.name !== 'N/A' ? movie.author.name : channelName,
      authorId: movie.author.id !== 'N/A' ? movie.author.id : channelId,
      lengthSeconds: isNaN(movie.duration.seconds) ? '' : movie.duration.seconds,
      isUpcoming: movie.is_upcoming,
      premiereDate: movie.upcoming
    }
  } else if (item.type === 'LockupView') {
    return parseLockupView(item, channelId, channelName)
  } else {
    /** @type {import('youtubei.js').YTNodes.Video} */
    const video = item

    if (
      // When video is passed in via like community post attachment
      video.title?.text === 'This video isn\'t publicly available' ||
      // `BADGE_STYLE_TYPE_MEMBERS_ONLY` is used for both `members only` and `members first` videos
      video.badges.some(badge => badge.style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY')
    ) {
      return null
    }

    let publishedText

    if (video.published != null && !video.published.isEmpty()) {
      publishedText = video.published.text
    }

    const published = calculatePublishedDate(
      publishedText,
      video.is_live,
      video.is_upcoming || video.is_premiere,
      video.upcoming
    )

    let viewCount = null

    if (video.view_count?.text) {
      viewCount = video.view_count.text.toLowerCase() === 'no views' ? 0 : extractNumberFromString(video.view_count.text)
    } else if (video.short_view_count?.text) {
      viewCount = video.short_view_count.text.toLowerCase() === 'no views' ? 0 : parseLocalSubscriberCount(video.short_view_count.text)
    }

    return {
      type: 'video',
      videoId: video.video_id,
      title: video.title.text?.trim(),
      author: video.author.name !== 'N/A' ? video.author.name : channelName,
      authorId: video.author.id !== 'N/A' ? video.author.id : channelId,
      collaborators: parseLocalCollaborators(video.author.collaborators),
      description: video.description,
      viewCount,
      published,
      lengthSeconds: isNaN(video.duration.seconds) ? '' : video.duration.seconds,
      liveNow: video.is_live,
      isUpcoming: video.is_upcoming || video.is_premiere,
      premiereDate: video.upcoming,
      isPremiere: video.is_premiere,
      isMusic: video.thumbnail_overlays.firstOfType(YTNodes.ThumbnailOverlayTimeStatus)?.icon_type === 'MUSIC',
      is4k: video.is_4k,
      is8k: video.badges.some(badge => badge.label === '8K'),
      isNew: video.badges.some(badge => badge.label === 'New'),
      isVr180: video.badges.some(badge => badge.label === 'VR180'),
      isVr360: video.badges.some(badge => badge.label === '360°'),
      is3d: video.badges.some(badge => badge.label === '3D'),
      hasCaptions: video.has_captions
    }
  }
}

const VIEWS_OR_WATCHING_REGEX = /\d+(?:\.\d+)?\s?(?:[bkm]|thousand|[bm]illion)?\s(?:views?|watching|waiting)/i
const VIEWS_IN_NUMBER_ONLY = /^\d+(\.\d)?[bkm]?$/i
const PREMIERES_TIME_REGEX = /^(premieres|scheduled for) /i
// Sometimes got `Streamed N (unit) ago`
const PUBLISH_TIME_REGEX = /^(streamed\s)?\d+\s?\w+?\sago/i

/**
 * @param {string | undefined} text
 */
function isViewCountText(text) {
  if (typeof text !== 'string') { return false }

  return VIEWS_OR_WATCHING_REGEX.test(text) || VIEWS_IN_NUMBER_ONLY.test(text)
}

/**
 * @param {string | undefined} text
 */
function isPremieresTimeText(text) {
  if (typeof text !== 'string') { return false }

  return PREMIERES_TIME_REGEX.test(text)
}

/**
 * @param {string | undefined} text
 */
function isPublishTimeText(text) {
  if (typeof text !== 'string') { return false }

  return PUBLISH_TIME_REGEX.test(text)
}

/**
 * @param {import('youtubei.js').YTNodes.LockupView} lockupView
 * @param {string | undefined} channelId
 * @param {string | undefined} channelName
 */
function parseLockupView(lockupView, channelId = undefined, channelName = undefined) {
  switch (lockupView.content_type) {
    case 'ALBUM':
    case 'SHOW':
    case 'PLAYLIST':
    case 'COURSE':
    case 'PODCAST': {
      const thumbnailOverlayBadgeView = lockupView.content_image.primary_thumbnail.overlays
        .find(overlay => overlay.is(YTNodes.ThumbnailOverlayBadgeView))

      const playlistId = lockupView.content_id

      // Filter out mixes without playlist pages (we don't support watch page-only mixes)
      // https://wiki.archiveteam.org/index.php/YouTube/Technical_details#Playlists
      if (playlistId.startsWith('RD') && !playlistId.startsWith('RDCL')) {
        return null
      }

      const maybeChannelText = lockupView.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text

      if (maybeChannelText && maybeChannelText.endpoint?.metadata.page_type === 'WEB_PAGE_TYPE_CHANNEL') {
        if (maybeChannelText.text !== 'Playlist') { channelName = maybeChannelText.text }
        channelId = maybeChannelText.endpoint.payload.browseId
      }

      const isCourse = lockupView.content_type === 'COURSE' || thumbnailOverlayBadgeView.badges.some(e => e.icon_name === 'COURSE')
      const isAlbum = lockupView.content_type === 'ALBUM' || thumbnailOverlayBadgeView.badges.some(e => e.icon_name === 'music')
      const isShow = lockupView.content_type === 'SHOW'

      return {
        type: 'playlist',
        dataSource: 'local',
        playlistId,
        title: lockupView.metadata.title.text,
        thumbnail: lockupView.content_image.primary_thumbnail.image[0].url,
        channelName,
        channelId,
        videoCount: extractNumberFromString(thumbnailOverlayBadgeView.badges[0].text),
        isPodcast: lockupView.content_type === 'PODCAST',
        isAlbum,
        isCourse,
        isShow,
      }
    }
    case 'SHORT':
    case 'STATION':
    case 'VIDEO': {
      const isStation = lockupView.content_type === 'STATION'
      let publishedText
      let lengthSeconds = ''
      let liveNow = false
      let isUpcoming = false
      let isPremiere = false
      let isMusic = false
      let premiereDate

      const isMemberOnly = lockupView.metadata.metadata?.metadata_rows.some(row => {
        return row.badges.some(badge => badge.style === 'BADGE_MEMBERS_ONLY')
      })
      if (isMemberOnly) {
        return null
      }

      /** @type {YTNodes.ThumbnailBottomOverlayView | undefined } */
      const thumbnailBottomOverlayView = lockupView.content_image?.overlays?.firstOfType(YTNodes.ThumbnailBottomOverlayView) ??
        lockupView.content_image?.primary_thumbnail?.overlays?.firstOfType(YTNodes.ThumbnailBottomOverlayView)

      if (thumbnailBottomOverlayView) {
        if (thumbnailBottomOverlayView.badges.some(badge => badge.badge_style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE')) {
          liveNow = true
          isPremiere = thumbnailBottomOverlayView.badges.some(badge => badge.text === 'PREMIERE')
        } else if (thumbnailBottomOverlayView.badges.some(badge => badge.text?.toLowerCase() === 'upcoming')) {
          isUpcoming = true

          for (const row of lockupView.metadata.metadata.metadata_rows) {
            const foundText = row.metadata_parts?.find(part => isPremieresTimeText(part.text?.text))?.text?.text
            if (foundText != null) {
              premiereDate = new Date(foundText)
              break
            }
          }
        } else {
          const durationBadge = thumbnailBottomOverlayView.badges.find(badge => /^[\d:,]+$/.test(badge.text))

          if (durationBadge) {
            lengthSeconds = Utils.timeToSeconds(durationBadge.text)
          }

          if (lockupView.metadata.metadata?.metadata_rows != null) {
            for (const row of lockupView.metadata.metadata.metadata_rows) {
              const foundText = row.metadata_parts?.find(part => isPublishTimeText(part.text?.text))?.text?.text
              if (foundText != null) {
                publishedText = foundText
                break
              }
            }
          }
        }

        if (thumbnailBottomOverlayView.badges.some(badge => badge.icon_name === 'MUSIC')) {
          isMusic = true
        }
      }

      let viewCount = null
      if (lockupView.metadata.metadata?.metadata_rows != null) {
        for (const row of lockupView.metadata.metadata.metadata_rows) {
          const foundText = row.metadata_parts?.find(part => {
            return isViewCountText(part.text?.text)
          })?.text?.text

          if (foundText != null) {
            const views = parseLocalSubscriberCount(foundText)

            if (!isNaN(views)) {
              viewCount = views
            }
            break
          }
        }
      }

      const maybeAuthorText = lockupView.metadata.metadata?.metadata_rows[0].metadata_parts?.[0].text?.text
      let author = channelName
      if (maybeAuthorText && !isViewCountText(maybeAuthorText) && !isPremieresTimeText(maybeAuthorText)) {
        author = maybeAuthorText
      }

      // I think this is only used for stations at the moment
      if (author == null) {
        author = lockupView.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.avatar_stack?.text?.text
      }

      let collaborators = []
      const maybeCollaborators = lockupView.metadata.image?.renderer_context?.command_context?.on_tap?.command?.inline_content?.custom_content?.items
        .filter(item => item.renderer_context?.command_context?.on_tap?.metadata?.page_type === 'WEB_PAGE_TYPE_CHANNEL')
      if (maybeCollaborators) {
        collaborators = parseLocalCollaborators(maybeCollaborators)
      }

      return {
        type: 'video',
        videoId: lockupView.content_id,
        title: lockupView.metadata.title.text?.trim(),
        author,
        authorId: lockupView.metadata.image?.renderer_context?.command_context?.on_tap?.payload.browseId ?? channelId,
        collaborators,
        viewCount,
        published: calculatePublishedDate(publishedText, liveNow, isUpcoming, premiereDate),
        lengthSeconds,
        liveNow,
        isUpcoming,
        isStation,
        isPremiere,
        isMusic,
        premiereDate
      }
    }
    default:
      console.warn(`Unknown lockup content type: ${lockupView.content_type}`, lockupView)
      return null
  }
}

/**
 * @param {import('youtubei.js').Helpers.YTNode} item
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
export function parseListItem(item, channelId, channelName) {
  switch (item.type) {
    case 'Movie':
    case 'Video':
    case 'GridVideo':
    case 'GridMovie':
    case 'VideoCard':
      return parseLocalListVideo(item, channelId, channelName)
    case 'GameCard': {
      /** @type {import('youtubei.js').YTNodes.GameCard} */
      const channel = item
      /** @type {import('youtubei.js').YTNodes.GameDetails} */
      const game = channel.game
      return {
        type: 'channel',
        dataSource: 'local',
        thumbnail: game.box_art.at(0).url.replace(/^\/\//, 'https://'),
        name: game.title.text,
        id: game.endpoint.payload.browseId,
        isGame: true
      }
    }
    case 'GridChannel': {
      /** @type {import('youtubei.js').YTNodes.GridChannel} */
      const channel = item
      let subscribers = null

      if (channel.subscribers?.text) {
        subscribers = parseLocalSubscriberCount(channel.subscribers.text)
      }

      const videos = extractNumberFromString(channel.video_count.text)

      return {
        type: 'channel',
        dataSource: 'local',
        thumbnail: channel.author.best_thumbnail?.url.replace(/^\/\//, 'https://'),
        name: channel.author.name,
        id: channel.author.id,
        subscribers,
        videos,
        handle: null,
        descriptionShort: channel.description_snippet?.text
      }
    }
    case 'Channel': {
      /** @type {import('youtubei.js').YTNodes.Channel} */
      const channel = item

      // see upstream TODO: https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/Channel.ts#L33

      // according to https://github.com/iv-org/invidious/issues/3514#issuecomment-1368080392
      // the response can be the new or old one, so we currently need to handle both here
      let subscribers = null
      let videos = null
      let handle = null
      if (channel.subscriber_count.text?.startsWith('@')) {
        handle = channel.subscriber_count.text

        if (!channel.video_count.isEmpty()) {
          subscribers = parseLocalSubscriberCount(channel.video_count.text)
        }
      } else {
        videos = extractNumberFromString(channel.video_count.text)

        if (!channel.subscriber_count.isEmpty()) {
          subscribers = parseLocalSubscriberCount(channel.subscriber_count.text)
        }
      }

      return {
        type: 'channel',
        dataSource: 'local',
        thumbnail: channel.author.best_thumbnail?.url.replace(/^\/\//, 'https://'),
        name: channel.author.name,
        id: channel.author.id,
        subscribers,
        videos,
        handle,
        descriptionShort: channel.description_snippet.text
      }
    }
    case 'HashtagTile': {
      /** @type {import('youtubei.js').YTNodes.HashtagTile} */
      const hashtag = item

      return {
        type: 'hashtag',
        title: hashtag.hashtag.text,
        videoCount: hashtag.hashtag_video_count.isEmpty() ? null : parseLocalSubscriberCount(hashtag.hashtag_video_count.text),
        channelCount: hashtag.hashtag_channel_count.isEmpty() ? null : parseLocalSubscriberCount(hashtag.hashtag_channel_count.text)
      }
    }
    case 'ReelItem':
    case 'ShortsLockupView': {
      return parseShort(item, channelId, channelName)
    }
    case 'CompactStation':
    case 'GridPlaylist':
    case 'Playlist': {
      return parseLocalListPlaylist(item, channelId, channelName)
    }
    case 'Post': {
      return parseLocalCommunityPost(item)
    }
    case 'LockupView':
      return parseLockupView(item, channelId, channelName)
  }
}

/**
 * @param {YTNodes.CompactVideo | YTNodes.CompactMovie | YTNodes.LockupView} video
 */
export function parseLocalWatchNextVideo(video) {
  if (video.is(YTNodes.CompactMovie)) {
    return {
      type: 'video',
      videoId: video.id,
      title: video.title.text?.trim(),
      author: video.author.name,
      authorId: video.author.id,
      collaborators: parseLocalCollaborators(video.author.collaborators),
      lengthSeconds: video.duration.seconds
    }
  } else if (video.is(YTNodes.LockupView)) {
    return parseLockupView(video)
  } else {
    let publishedText

    if (video.published != null && !video.published.isEmpty()) {
      publishedText = video.published.text
    }

    const published = calculatePublishedDate(publishedText, video.is_live, video.is_premiere)

    return {
      type: 'video',
      videoId: video.video_id,
      title: video.title.text?.trim(),
      author: video.author.name,
      authorId: video.author.id,
      collaborators: parseLocalCollaborators(video.author.collaborators),
      viewCount: video.view_count == null ? null : extractNumberFromString(video.view_count.text),
      published,
      lengthSeconds: isNaN(video.duration.seconds) ? '' : video.duration.seconds,
      liveNow: video.is_live,
      isUpcoming: video.is_premiere
    }
  }
}

function convertSearchFilters(filters) {
  const convertedFilters = {}

  // some of the fields have different names and
  // others have empty strings that we don't want to pass to youtubei.js

  if (filters) {
    if (filters.prioritize) {
      convertedFilters.prioritize = filters.prioritize
    }

    if (filters.time) {
      convertedFilters.upload_date = filters.time
    }

    if (filters.type) {
      convertedFilters.type = filters.type
    }

    if (filters.duration) {
      convertedFilters.duration = filters.duration
    }

    if (filters.features) {
      convertedFilters.features = filters.features
    }
  }

  return convertedFilters
}

/**
 * @param {(Misc.TextRun|Misc.EmojiRun)[]} runs
 * @param {number} emojiSize
 * @param {{looseChannelNameDetection: boolean}} options
 */
export function parseLocalTextRuns(runs, emojiSize = 16, options = { looseChannelNameDetection: false }) {
  if (!Array.isArray(runs)) {
    throw new Error('not an array of text runs')
  }

  const timestampRegex = /^(?:\d+:){1,2}\d+$/
  const spacesBeforeRegex = /^\s+/
  const spacesAfterRegex = /\s+$/
  const parsedRuns = []

  for (const run of runs) {
    // may contain HTML, so we need to escape it, as we don't render unwanted HTML
    // example: https://youtu.be/Hh_se2Zqsdk (see pinned comment)
    const text = escapeHTML(run.text)

    if (run instanceof Misc.EmojiRun) {
      const { emoji } = run

      // empty array if video creator removes a channel emoji so we ignore.
      // eg: pinned comment here https://youtu.be/v3wm83zoSSY
      if (emoji.image.length > 0) {
        let altText

        if (emoji.is_custom) {
          if (emoji.shortcuts.length > 0) {
            altText = emoji.shortcuts[0]
          } else if (emoji.search_terms.length > 0) {
            altText = emoji.search_terms.join(', ')
          } else {
            altText = 'Custom emoji'
          }
        } else {
          altText = text
        }

        // lazy load the emoji image so it doesn't delay rendering of the text
        // by defining a height and width, that space is reserved until the image is loaded
        // that way we avoid layout shifts when it loads
        parsedRuns.push(`<img src="${emoji.image[0].url}" alt="${altText}" width="${emojiSize}" height="${emojiSize}" loading="lazy" style="vertical-align: middle">`)
      }
    } else {
      const { bold, italics, strikethrough, endpoint } = run

      if (endpoint) {
        switch (endpoint.metadata.page_type) {
          case 'WEB_PAGE_TYPE_WATCH':
            if (timestampRegex.test(text)) {
              parsedRuns.push(text)
            } else {
              parsedRuns.push(`https://www.youtube.com${endpoint.metadata.url}`)
            }
            break
          case 'WEB_PAGE_TYPE_CHANNEL': {
            const trimmedText = text.trim()
            // In comments, mention can be `@Channel Name` (not handle, but name)
            if (CHANNEL_HANDLE_REGEX.test(trimmedText) || options.looseChannelNameDetection) {
              // Note that in regex `\s` must be used since the text contain non-default space (the half-width space char when we press spacebar)
              const spacesBefore = (spacesBeforeRegex.exec(text) || [''])[0]
              const spacesAfter = (spacesAfterRegex.exec(text) || [''])[0]
              parsedRuns.push(`${spacesBefore}<a href="https://www.youtube.com/channel/${endpoint.payload.browseId}">${trimmedText}</a>${spacesAfter}`)
            } else {
              parsedRuns.push(`https://www.youtube.com${endpoint.metadata.url}`)
            }
            break
          }
          case 'WEB_PAGE_TYPE_PLAYLIST':
          case 'WEB_PAGE_TYPE_SHORTS':
            parsedRuns.push(`https://www.youtube.com${endpoint.metadata.url}`)
            break
          case 'WEB_PAGE_TYPE_BROWSE':
            parsedRuns.push(`<a href="https://www.youtube.com${endpoint.metadata.url}">${text}</a>`)
            break
          case 'WEB_PAGE_TYPE_UNKNOWN':
          default: {
            const url = new URL((endpoint.dialog?.type === 'ConfirmDialog' && endpoint.dialog.confirm_button.endpoint.payload.url) || endpoint.payload.url)
            const redirectTarget = getYouTubeRedirectTarget(url)
            if (redirectTarget != null) {
              // remove utm tracking parameters
              const realURL = new URL(redirectTarget)
              let urlChanged = false

              TRACKING_PARAM_NAMES.forEach((paramName) => {
                if (!realURL.searchParams.has(paramName)) { return }

                realURL.searchParams.delete(paramName)
                urlChanged = true
              })

              // `searchParams.delete` changes query string unnecessarily
              // Using original unless there is any change
              parsedRuns.push(urlChanged ? realURL.toString() : redirectTarget)
            } else {
              // this is probably a special YouTube URL like http://www.youtube.com/approachingnirvana
              parsedRuns.push(endpoint.payload.url)
            }
            break
          }
        }
      } else {
        let formattedText = text
        if (bold) {
          formattedText = `<b>${formattedText}</b>`
        }

        if (italics) {
          formattedText = `<i>${formattedText}</i>`
        }

        if (strikethrough) {
          formattedText = `<s>${formattedText}</s>`
        }

        parsedRuns.push(formattedText)
      }
    }
  }

  return parsedRuns.join('')
}

/**
 * @param {LocalFormat} format
 */
export function mapLocalLegacyFormat(format) {
  return {
    itag: format.itag,
    qualityLabel: format.quality_label,
    fps: format.fps,
    bitrate: format.bitrate,
    mimeType: format.mime_type,
    height: format.height,
    width: format.width,
    url: format.freeTubeUrl
  }
}

/**
 * The complete Triforce, or one or more components of the Triforce.
 * @typedef {object} LocalComment
 * @property {string} id
 * @property {'local'} dataType
 * @property {string} author
 * @property {string} authorId
 * @property {string} authorThumb
 * @property {number} likes
 * @property {string} text
 * @property {string} time
 * @property {boolean} isHearted
 * @property {boolean} isMember
 * @property {boolean} isOwner
 * @property {boolean} isPinned
 * @property {boolean} hasOwnerReplied
 * @property {boolean} hasReplyToken
 * @property {(YTNodes.CommentThread | Misc.CommentsContinuation)?} replyToken
 * @property {number} replyLevel
 * @property {string} memberIconUrl
 * @property {number} numReplies
 */
/**
 * @param {import('youtubei.js').YTNodes.CommentView} comment
 * @param {import('youtubei.js').YTNodes.CommentThread | undefined} commentThread
 * @return {LocalComment}
 */
export function parseLocalComment(comment, commentThread = undefined) {
  const replyToken = commentThread ?? null
  let hasOwnerReplied = false
  let hasReplyToken = false
  let numReplies = 0

  if (commentThread?.has_replies) {
    hasOwnerReplied = !!commentThread.comment_replies_data?.has_channel_owner_replied
    hasReplyToken = true
    numReplies = parseLocalSubscriberCount(commentThread.comment_replies_data?.view_replies?.text || '0')
  }

  const commentTextRuns = comment.voice_reply_container?.transcript_text?.runs ?? comment.content?.runs ?? []

  return {
    id: comment.comment_id,
    dataType: 'local',
    author: comment.author?.name ?? '',
    authorId: comment.author?.id ?? '',
    authorThumb: comment.author?.best_thumbnail?.url ?? '',
    isPinned: comment.is_pinned,
    isOwner: !!comment.author_is_channel_owner,
    isMember: !!comment.is_member,
    text: Autolinker.link(parseLocalTextRuns(commentTextRuns, 16, { looseChannelNameDetection: true })),
    isHearted: !!comment.is_hearted,
    hasOwnerReplied,
    hasReplyToken,
    replyToken,
    replyLevel: comment.reply_level ?? 0,
    memberIconUrl: comment.member_badge?.url ?? '',
    time: getRelativeTimeFromDate(calculatePublishedDate((comment.published_time ?? '').replace('(edited)', '').trim()) ?? 0, false),
    likes: parseLocalSubscriberCount(comment.like_count?.trim() || '0'),
    numReplies
  }
}

/**
 * @param {string} text
 */
export function parseLocalSubscriberCount(text) {
  const match = text.match(/(\d+)(?:[,.](\d+))?\s?([BKMbkm]|thousand|[bm]illion)\b/)

  if (match) {
    let multiplier = 0

    switch (match[3]) {
      case 'K':
      case 'k':
      case 'thousand':
        multiplier = 3
        break
      case 'M':
      case 'm':
      case 'million':
        multiplier = 6
        break
      case 'B':
      case 'b':
      case 'billion':
        multiplier = 9
        break
    }

    let parsedDecimals
    if (typeof match[2] === 'undefined') {
      parsedDecimals = '0'.repeat(multiplier)
    } else {
      parsedDecimals = match[2].padEnd(multiplier, '0')
    }

    return parseInt(match[1] + parsedDecimals)
  } else {
    return extractNumberFromString(text)
  }
}

/**
 * Parse community posts
 * @param {import('youtubei.js').YTNodes.BackstagePost[] | import('youtubei.js').YTNodes.SharedPost[] | import('youtubei.js').YTNodes.Post[] } posts
 */
export function parseLocalCommunityPosts(posts) {
  const foundIds = []
  // `posts` includes the SharedPost's attached post for some reason so we need to filter that out.
  // see: https://github.com/FreeTubeApp/FreeTube/issues/3252#issuecomment-1546675781
  // we don't currently support SharedPost's so that is also filtered out
  for (const post of posts) {
    if (post.type === 'SharedPost') {
      // `original_post` can be null if it was deleted
      if (post.original_post) {
        foundIds.push(post.original_post.id)
      }
      foundIds.push(post.id)
    }
  }

  return posts.filter(post => {
    return !foundIds.includes(post.id)
  }).map(parseLocalCommunityPost)
}

/**
 * Parse community post
 * @param {import('youtubei.js').YTNodes.BackstagePost} post
 */
function parseLocalCommunityPost(post) {
  let replyCount = post.action_buttons?.reply_button?.text ?? null
  if (replyCount !== null) {
    replyCount = parseLocalSubscriberCount(post?.action_buttons.reply_button.text)
  }

  const authorThumbnails = post.author.thumbnails

  authorThumbnails.forEach((thumbnail) => {
    if (thumbnail.url.startsWith('//')) {
      thumbnail.url = 'https:' + thumbnail.url
    }
  })

  return {
    postText: post.content.isEmpty() ? '' : Autolinker.link(parseLocalTextRuns(post.content.runs, 16)),
    postId: post.id,
    authorThumbnails,
    publishedTime: calculatePublishedDate(post.published.text),
    // YouTube hides the vote/like count on posts when it is zero
    voteCount: post.vote_count ? parseLocalSubscriberCount(post.vote_count.text) : 0,
    postContent: parseLocalAttachment(post.attachment),
    commentCount: replyCount,
    authorId: post.author.id,
    author: post.author.name,
    type: 'community'
  }
}

function parseLocalAttachment(attachment) {
  if (!attachment) {
    return null
  }
  // image post
  if (attachment.type === 'BackstageImage') {
    return {
      type: 'image',
      content: attachment.image
    }
  } else if (attachment.type === 'Video') {
    const parsedVideo = parseLocalListVideo(attachment)
    if (parsedVideo == null) return null

    return {
      type: 'video',
      content: parsedVideo
    }
  } else if (attachment.type === 'Playlist') {
    return {
      type: 'playlist',
      content: parseLocalListPlaylist(attachment)
    }
  } else if (attachment.type === 'PostMultiImage') {
    return {
      type: 'multiImage',
      content: attachment.images.map(thumbnail => thumbnail.image)
    }
  } else if (attachment.type === 'Poll') {
    return {
      type: 'poll',
      totalVotes: parseLocalSubscriberCount(attachment.total_votes.text) ?? 0,
      content: attachment.choices.map(choice => {
        return {
          text: choice.text.text,
          image: choice.image
        }
      })
    }
  } else if (attachment.type === 'Quiz') {
    return {
      type: 'quiz',
      totalVotes: parseLocalSubscriberCount(attachment.total_votes.text) ?? 0,
      content: Object.values(attachment.choices).map(choice => {
        return {
          text: choice.text.text,
          isCorrect: choice.is_correct,
          image: choice.image
        }
      })
    }
  } else {
    console.error(`Unknown Local community post type: ${attachment.type}`)
    console.error(attachment)
  }
}

/**
 * @param {import('youtubei.js').YTNodes.ListItemView[]} collaborators
 */
function parseLocalCollaborators(collaborators) {
  return collaborators.map(collaborator => ({
    id: collaborator.renderer_context?.command_context?.on_tap?.payload?.browseId,
    name: collaborator.title?.text,
  }))
}

export async function getHashtagLocal(hashtag) {
  const innertube = await createInnertube()
  return await innertube.getHashtag(hashtag)
}

export async function getLocalCommunityPost(postId, channelId) {
  const innertube = await createInnertube()
  if (channelId == null) {
    channelId = await getLocalChannelId('https://www.youtube.com/post/' + postId, true)
  }

  const postPage = await innertube.getPost(postId, channelId)
  return parseLocalCommunityPost(postPage.posts[0])
}

/**
 * @param {string} postId
 * @param {string} channelId
 */
export async function getLocalCommunityPostComments(postId, channelId) {
  const innertube = await createInnertube({ generateSessionLocally: false })

  return await innertube.getPostComments(postId, channelId)
}

export async function getLocalClip(clipId) {
  const innertube = await createInnertube()

  const clipResponse = await innertube.resolveURL('https://www.youtube.com/clip/' + clipId)

  const videoId = clipResponse?.payload?.videoId

  return parseVideoClipsParams(videoId, clipResponse.payload.params)
}
