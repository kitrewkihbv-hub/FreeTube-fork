/**
 * Try the authenticated subscriptions page on both supported clients. Only if both
 * fail, build a limited feed from the account's subscribed channels and public uploads.
 * No channel list is imported or modified by this operation.
 */
export async function loadAccountActivity({ tv, getWebClient, getRawFeed, getRows, parseItems, getSubscriptions, getChannelVideos }) {
  const errors = []
  const readFeed = async (client, raw) => {
    let feed = raw ? await getRawFeed(client.actions, 'FEsubscriptions') : await client.getSubscriptionsFeed()
    const videos = []
    const seen = new Set()
    // A small bounded number of pages avoids an unbounded launch-time request.
    for (let page = 0; feed && page < 2; page++) {
      for (const video of parseItems(getRows(feed))) {
        if (video.videoId && !seen.has(video.videoId)) {
          seen.add(video.videoId)
          videos.push(video)
        }
      }
      if (!feed.has_continuation || page === 1) break
      try {
        feed = await feed.getContinuation()
      } catch (error) {
        if (!videos.length) throw error
        console.warn('Could not load the next subscriptions page', error)
        break
      }
    }
    return videos
  }

  for (const getClient of [async () => tv, getWebClient]) {
    let client
    try {
      client = await getClient()
    } catch (error) {
      errors.push(error)
      continue
    }
    for (const raw of [true, false]) {
      try {
        const videos = await readFeed(client, raw)
        if (videos.length) return { videos, source: 'youtube', partial: false }
      } catch (error) {
        errors.push(error)
      }
    }
  }

  // Last resort: fetch uploads only for channels actually returned as subscribed.
  // This is capped and reported as partial instead of pretending to be YouTube's feed.
  try {
    const subscriptions = await getSubscriptions()
    const channels = subscriptions.channels.slice(0, 40)
    const videos = []
    let failed = 0
    for (let i = 0; i < channels.length; i += 5) {
      const results = await Promise.all(channels.slice(i, i + 5).map(async channel => {
        try {
          const result = await getChannelVideos(channel.id)
          if (!result || !Array.isArray(result.videos)) throw new Error('No channel videos returned')
          return result.videos.map(video => ({ ...video, author: video.author ?? channel.name, authorId: video.authorId ?? channel.id }))
        } catch (error) {
          failed++
          console.warn('Could not load uploads for a subscribed channel', error)
          return []
        }
      }))
      videos.push(...results.flat())
    }
    const seen = new Set()
    const unique = videos.filter(video => video.type === 'video' && video.videoId && !seen.has(video.videoId) && seen.add(video.videoId))
    unique.sort((a, b) => (b.published ?? 0) - (a.published ?? 0))
    if (unique.length) {
      return { videos: unique, source: 'channelUploads', partial: true, channelCount: channels.length, failedChannelCount: failed }
    }
  } catch (error) {
    errors.push(error)
  }

  throw new Error('YouTube returned no readable subscription videos.', { cause: errors.at(-1) })
}
