/**
 * Read several pages of the authenticated subscriptions feed. If YouTube only
 * returns a small feed, supplement it with uploads from its subscribed channels.
 * No channel list is imported or modified by this operation.
 */
export async function loadAccountActivity({ tv, getWebClient, getRawFeed, getRows, parseItems, getSubscriptions, getChannelVideos }) {
  const errors = []
  const videos = []
  const seen = new Set()
  let feedIncomplete = false

  function addVideos(items) {
    for (const video of items) {
      if (video?.type === 'video' && video.videoId && !seen.has(video.videoId)) {
        seen.add(video.videoId)
        videos.push(video)
      }
    }
  }

  const readFeed = async (client, raw) => {
    let feed = raw ? await getRawFeed(client.actions, 'FEsubscriptions') : await client.getSubscriptionsFeed()
    let incomplete = false
    for (let page = 0; feed && page < 5; page++) {
      addVideos(parseItems(getRows(feed)))
      if (!feed.has_continuation) break
      if (page === 4) {
        incomplete = true
        break
      }
      try {
        feed = await feed.getContinuation()
      } catch (error) {
        if (error?.code === 'YOUTUBE_AUTH_FAILED') throw error
        incomplete = true
        errors.push(error)
        break
      }
    }
    return incomplete
  }

  for (const getClient of [async () => tv, getWebClient]) {
    let client
    try {
      client = await getClient()
    } catch (error) {
      if (error?.code === 'YOUTUBE_AUTH_FAILED') throw error
      errors.push(error)
      continue
    }
    for (const raw of [true, false]) {
      try {
        feedIncomplete = (await readFeed(client, raw)) || feedIncomplete
        if (videos.length >= 25) return { videos, source: 'youtube', partial: feedIncomplete }
      } catch (error) {
        if (error?.code === 'YOUTUBE_AUTH_FAILED') throw error
        errors.push(error)
      }
    }
  }

  // Only add public uploads from channels actually returned as subscribed.
  // The account's list can be incomplete; keep that fact visible to the user.
  try {
    const subscriptions = await getSubscriptions()
    const channels = subscriptions.channels.slice(0, 40)
    const uploads = []
    let failed = 0
    for (let i = 0; i < channels.length; i += 2) {
      const results = await Promise.all(channels.slice(i, i + 2).map(async channel => {
        try {
          const result = await getChannelVideos(channel.id)
          if (!result || !Array.isArray(result.videos)) throw new Error('No channel videos returned')
          return result.videos.map(video => ({ ...video, author: video.author ?? channel.name, authorId: channel.id }))
        } catch (error) {
          if (error?.code === 'YOUTUBE_AUTH_FAILED') throw error
          failed++
          console.warn('Could not load uploads for a subscribed channel', error)
          return []
        }
      }))
      uploads.push(...results.flat())
    }
    uploads.sort((a, b) => (b.published ?? 0) - (a.published ?? 0))
    const hadFeed = videos.length > 0
    addVideos(uploads)
    if (videos.length) {
      return {
        videos,
        source: hadFeed ? 'mixed' : 'channelUploads',
        partial: true,
        channelCount: channels.length,
        failedChannelCount: failed,
      }
    }
  } catch (error) {
    if (error?.code === 'YOUTUBE_AUTH_FAILED') throw error
    errors.push(error)
  }

  if (videos.length) return { videos, source: 'youtube', partial: true }
  throw new Error('YouTube returned no readable subscription videos.', { cause: errors.at(-1) })
}
