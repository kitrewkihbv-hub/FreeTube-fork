const VIDEO_RENDERER_KEYS = new Set([
  'compactVideoRenderer',
  'gridVideoRenderer',
  'playlistVideoRenderer',
  'pivotVideoRenderer',
  'reelItemRenderer',
  'shortsLockupViewModel',
  'tileRenderer',
  'tvMusicVideoRenderer',
  'videoRenderer',
])

const PLAYLIST_RENDERER_KEYS = new Set([
  'compactPlaylistRenderer',
  'gridPlaylistRenderer',
  'gridShowRenderer',
  'pivotPlaylistRenderer',
  'playlistRenderer',
  'tileRenderer',
])

const ITEM_CONTAINER_KEYS = [
  'content',
  'tvBrowseRenderer',
  'tvSurfaceContentRenderer',
  'gridRenderer',
  'playlistVideoListRenderer',
  'richGridRenderer',
  'sectionListRenderer',
  'horizontalListRenderer',
  'itemSectionRenderer',
  'shelfRenderer',
  'richItemRenderer',
  'sectionListContinuation',
  'gridContinuation',
  'playlistVideoListContinuation',
  'appendContinuationItemsAction',
  'reloadContinuationItemsCommand',
  'continuationItems',
]

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getRawResponseData(response) {
  return isRecord(response?.data) ? response.data : response
}

/**
 * Reads the text fields used by both modern InnerTube models and raw renderer JSON.
 * @param {unknown} value
 * @returns {string}
 */
export function getYouTubeAccountRawText(value) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!isRecord(value)) {
    return ''
  }

  for (const key of ['text', 'simpleText', 'content']) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') {
      return value[key].trim()
    }
  }

  if (Array.isArray(value.runs)) {
    const text = value.runs.map((run) => {
      if (typeof run?.text === 'string') {
        return run.text
      }

      return getYouTubeAccountRawText(run?.text)
    }).join('').trim()

    if (text !== '') {
      return text
    }
  }

  const accessibilityLabel = value.accessibility?.accessibilityData?.label

  return typeof accessibilityLabel === 'string' ? accessibilityLabel.trim() : ''
}

function isVideoRenderer(rendererKey, renderer) {
  if (!isRecord(renderer)) {
    return false
  }

  if (rendererKey === 'tileRenderer') {
    return renderer.contentType === 'TILE_CONTENT_TYPE_VIDEO'
  }

  if (rendererKey === 'lockupViewModel') {
    return /VIDEO|MOVIE|SHORT|STATION/.test(String(renderer.contentType ?? '').toUpperCase())
  }

  return VIDEO_RENDERER_KEYS.has(rendererKey) && rendererKey !== 'tileRenderer'
}

function isPlaylistRenderer(rendererKey, renderer) {
  if (!isRecord(renderer)) {
    return false
  }

  if (rendererKey === 'tileRenderer') {
    return renderer.contentType === 'TILE_CONTENT_TYPE_PLAYLIST'
  }

  if (rendererKey === 'lockupViewModel') {
    return /PLAYLIST/.test(String(renderer.contentType ?? '').toUpperCase())
  }

  return PLAYLIST_RENDERER_KEYS.has(rendererKey) && rendererKey !== 'tileRenderer'
}

function getEndpointValues(renderer) {
  return [
    renderer?.endpoint,
    renderer?.navigationEndpoint,
    renderer?.onSelectCommand,
    renderer?.onTapEndpoint,
    renderer?.onTap,
    renderer?.serviceEndpoint,
    renderer?.rendererContext?.commandContext,
    renderer?.rendererContext?.commandContext?.onTap,
  ].filter(isRecord)
}

function getEndpointVideoId(endpoint) {
  const candidates = [
    endpoint?.payload?.videoId,
    endpoint?.payload?.watchEndpoint?.videoId,
    endpoint?.payload?.reelWatchEndpoint?.videoId,
    endpoint?.watchEndpoint?.videoId,
    endpoint?.reelWatchEndpoint?.videoId,
    endpoint?.innertubeCommand?.watchEndpoint?.videoId,
    endpoint?.innertubeCommand?.reelWatchEndpoint?.videoId,
    endpoint?.command?.watchEndpoint?.videoId,
    endpoint?.command?.reelWatchEndpoint?.videoId,
  ]

  return candidates.find(candidate => typeof candidate === 'string' && candidate.trim() !== '')
}

function getRawVideoId(renderer) {
  const contentType = String(renderer?.contentType ?? '').toUpperCase()
  const isVideoLockup = /VIDEO|MOVIE|SHORT|STATION/.test(contentType)
  const directId = renderer?.videoId ?? renderer?.video_id ??
    (isVideoLockup || renderer?.contentType === 'TILE_CONTENT_TYPE_VIDEO' ? renderer?.contentId ?? renderer?.content_id : undefined)
  const endpointId = getEndpointValues(renderer).map(getEndpointVideoId).find(Boolean)
  const videoId = directId ?? endpointId

  return typeof videoId === 'string' && videoId.trim() !== '' ? videoId.trim() : undefined
}

function getEndpointPlaylistId(endpoint) {
  const candidates = [
    endpoint?.payload?.playlistId,
    endpoint?.payload?.browseId,
    endpoint?.payload?.watchEndpoint?.playlistId,
    endpoint?.payload?.browseEndpoint?.browseId,
    endpoint?.playlistId,
    endpoint?.watchEndpoint?.playlistId,
    endpoint?.browseEndpoint?.browseId,
    endpoint?.innertubeCommand?.watchEndpoint?.playlistId,
    endpoint?.innertubeCommand?.browseEndpoint?.browseId,
    endpoint?.command?.watchEndpoint?.playlistId,
    endpoint?.command?.browseEndpoint?.browseId,
  ]

  return candidates.find(candidate => typeof candidate === 'string' && candidate.trim() !== '')
}

function getRawPlaylistId(renderer) {
  const directId = renderer?.playlistId ?? renderer?.contentId ?? renderer?.content_id
  const endpointId = getEndpointValues(renderer).map(getEndpointPlaylistId).find(Boolean)
  const playlistId = directId ?? endpointId

  return typeof playlistId === 'string' && playlistId.trim() !== '' ? playlistId.trim() : undefined
}

function getPrimaryContent(data) {
  const tvBrowseContent = data?.contents?.tvBrowseRenderer?.content
  const tvSurfaceContent = tvBrowseContent?.tvSurfaceContentRenderer?.content

  if (tvSurfaceContent) {
    return tvSurfaceContent
  }

  const tvTabs = tvBrowseContent?.tvSecondaryNavRenderer?.sections
    ?.flatMap(section => section?.tvSecondaryNavSectionRenderer?.tabs ?? [])
    .map(tab => tab?.tabRenderer ?? tab?.expandableTabRenderer)
    .filter(isRecord) ?? []
  const preferredTVTab = tvTabs.find(tab => tab.selected) ?? tvTabs[0]

  if (preferredTVTab?.content) {
    return preferredTVTab.content.tvSurfaceContentRenderer?.content ?? preferredTVTab.content
  }

  const browse = data?.contents?.twoColumnBrowseResultsRenderer ?? data?.contents?.singleColumnBrowseResultsRenderer
  const tabs = browse?.tabs?.map(tab => tab?.tabRenderer ?? tab?.expandableTabRenderer).filter(isRecord) ?? []
  const preferredTab = tabs.find(tab => tab.selected) ?? tabs[0]

  return preferredTab?.content ?? browse ?? data?.contents
}

function getRowsFromContainer(container, depth = 0) {
  if (!isRecord(container) || depth > 24) {
    return undefined
  }

  const directRows = [
    container.gridRenderer?.items,
    container.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer?.contents,
    container.playlistVideoListRenderer?.contents,
    container.richGridRenderer?.contents,
    container.sectionListRenderer?.contents,
    container.horizontalListRenderer?.items,
    container.gridContinuation?.items,
    container.playlistVideoListContinuation?.contents,
    container.sectionListContinuation?.contents,
    container.itemSectionRenderer?.contents,
    container.appendContinuationItemsAction?.continuationItems,
    container.reloadContinuationItemsCommand?.continuationItems,
  ].find(rows => Array.isArray(rows) && rows.length > 0)

  if (directRows) {
    return directRows
  }

  for (const key of ITEM_CONTAINER_KEYS) {
    const child = container[key]

    if (isRecord(child)) {
      const rows = getRowsFromContainer(child, depth + 1)

      if (rows?.length) {
        return rows
      }
    } else if (Array.isArray(child)) {
      for (const item of child) {
        const rows = getRowsFromContainer(item, depth + 1)

        if (rows?.length) {
          return rows
        }
      }
    }
  }

  if (Array.isArray(container.contents)) {
    for (const item of container.contents) {
      const rows = getRowsFromContainer(item, depth + 1)

      if (rows?.length) {
        return rows
      }
    }
  }

  return undefined
}

function getPrimaryRawRows(responseData) {
  const data = getRawResponseData(responseData)
  const primaryContent = getPrimaryContent(data)
  const primaryRows = getRowsFromContainer(primaryContent)

  if (primaryRows?.length) {
    return primaryRows
  }

  const continuationRows = getRowsFromContainer(data?.continuationContents)

  if (continuationRows?.length) {
    return continuationRows
  }

  const receivedActions = data?.onResponseReceivedActions ?? data?.onResponseReceivedCommands ?? []

  for (const action of receivedActions) {
    const actionRows = getRowsFromContainer(action)

    if (actionRows?.length) {
      return actionRows
    }
  }

  return []
}

function getRendererRecords(rows, kind) {
  const records = []
  const seenIds = new Set()
  const visited = new Set()
  const isTargetRenderer = kind === 'video' ? isVideoRenderer : isPlaylistRenderer
  const getItemId = kind === 'video' ? getRawVideoId : getRawPlaylistId

  const visit = (value, depth = 0) => {
    if (depth > 24 || value === null || typeof value !== 'object' || visited.has(value)) {
      return
    }

    visited.add(value)

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (isRecord(child) && (isTargetRenderer(key, child) || (key === 'lockupViewModel' && isTargetRenderer(key, child)))) {
        const id = getItemId(child)

        if (id && !seenIds.has(id)) {
          seenIds.add(id)
          records.push({ rendererKey: key, renderer: child, id })
        }

        // Do not descend into a playlist's preview videos (or a video's menu).
        continue
      }

      if (isRecord(child) || Array.isArray(child)) {
        visit(child, depth + 1)
      }
    }
  }

  visit(rows)

  return records
}

function makeRawVideoItem(record) {
  const publishedText = getYouTubeAccountRawText(record.renderer.publishedTimeText)

  return {
    __youtubeAccountRawItem: record.renderer,
    __youtubeAccountRawItemType: record.rendererKey,
    published: publishedText ? { text: publishedText } : undefined,
  }
}

function makeRawPlaylistItem(record) {
  const renderer = record.renderer
  const title = getYouTubeAccountRawText(
    renderer.title ?? renderer.metadata?.lockupMetadataViewModel?.title ?? renderer.metadata?.tileMetadataRenderer?.title
  )
  const firstVideos = Array.isArray(renderer.videos)
    ? getRendererRecords(renderer.videos, 'video').map(makeRawVideoItem)
    : []

  return {
    id: record.id,
    title: { text: title },
    first_videos: firstVideos,
  }
}

function getContinuationTokenFromNode(node, depth = 0, visited = new Set()) {
  if (depth > 24 || node === null || typeof node !== 'object' || visited.has(node)) {
    return undefined
  }

  visited.add(node)

  if (Array.isArray(node)) {
    for (const item of node) {
      const token = getContinuationTokenFromNode(item, depth + 1, visited)

      if (token) {
        return token
      }
    }

    return undefined
  }

  const token = node.nextContinuationData?.continuation ??
    node.reloadContinuationData?.continuation ??
    node.continuationEndpoint?.continuationCommand?.token ??
    node.continuationCommand?.token

  if (typeof token === 'string' && token.trim() !== '') {
    return token
  }

  for (const value of Object.values(node)) {
    const childToken = getContinuationTokenFromNode(value, depth + 1, visited)

    if (childToken) {
      return childToken
    }
  }

  return undefined
}

/**
 * Extracts a continuation token from the selected TV/Web browse result or a
 * continuation response, without depending on youtubei.js' renderer parser.
 * @param {object} response
 * @returns {string|undefined}
 */
export function getYouTubeAccountRawContinuationToken(response) {
  const data = getRawResponseData(response)
  const roots = [
    data?.continuationContents,
    data?.onResponseReceivedActions,
    data?.onResponseReceivedCommands,
    getPrimaryContent(data),
  ]

  for (const root of roots) {
    const token = getContinuationTokenFromNode(root)

    if (token) {
      return token
    }
  }

  return undefined
}

/**
 * Creates a lightweight feed around raw InnerTube browse JSON. youtubei.js currently
 * does not expose some TV renderer trees (for example tvBrowseRenderer tabs) as feed
 * items, but the response still carries video/playlist IDs and continuation tokens.
 * @param {object} response Raw API response or an Actions.execute response wrapper
 * @param {object} actions Innertube Actions instance used for continuation requests
 * @returns {object}
 */
export function createYouTubeAccountRawFeed(response, actions) {
  const data = getRawResponseData(response)
  const rows = getPrimaryRawRows(data)
  const videoItems = getRendererRecords(rows, 'video').map(makeRawVideoItem)
  const playlists = getRendererRecords(rows, 'playlist').map(makeRawPlaylistItem)
  const continuationToken = getYouTubeAccountRawContinuationToken(data)

  return {
    actions,
    videos: videoItems,
    items: videoItems,
    playlists,
    has_continuation: Boolean(continuationToken),
    async getContinuation() {
      if (!continuationToken || typeof actions?.execute !== 'function') {
        throw new Error('The YouTube response has no usable continuation.')
      }

      const nextResponse = await actions.execute('/browse', { continuation: continuationToken })

      return createYouTubeAccountRawFeed(nextResponse, actions)
    },
  }
}

/**
 * Extract the recommendations area of a watch-next response without collecting
 * videos from the current video, comments, navigation, or unrelated menus.
 * @param {object} response Raw InnerTube response or Actions.execute wrapper
 * @returns {object[]}
 */
export function getYouTubeRelatedVideoItems(response) {
  const data = getRawResponseData(response)
  const web = data?.contents?.twoColumnWatchNextResults?.secondaryResults
  const mobile = data?.contents?.singleColumnWatchNextResults
  const roots = [web, mobile?.pivot, mobile?.results?.results?.contents].filter(Boolean)
  const records = getRendererRecords(roots, 'video')
  return records.map(makeRawVideoItem)
}

/**
 * Returns the raw renderer attached to an item made by createYouTubeAccountRawFeed.
 * @param {object|undefined} item
 * @returns {object|undefined}
 */
export function getYouTubeAccountRawItem(item) {
  return isRecord(item?.__youtubeAccountRawItem) ? item.__youtubeAccountRawItem : undefined
}
