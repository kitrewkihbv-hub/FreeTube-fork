// Normalize youtubei.js YouTube Music search shelves into safe, playable rows.
function parseMusicSearchResults(response) {
  const contents = response?.contents
  const shelves = Array.isArray(contents) ? contents : contents ? [contents] : []
  const results = []
  const seen = new Set()
  for (const shelf of shelves) {
    if (!Array.isArray(shelf?.contents)) continue
    for (const item of shelf.contents) {
      if (!item || !['song', 'video'].includes(item.item_type)) continue
      const id = item.id || item.endpoint?.payload?.videoId
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(id) || seen.has(id)) continue
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      if (!title) continue
      seen.add(id)
      const artists = Array.isArray(item.artists) ? item.artists : Array.isArray(item.authors) ? item.authors : []
      const artist = artists.map(person => person?.name).filter(name => typeof name === 'string' && name).join(', ')
      let artwork = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
      const rawThumbnails = item.thumbnails || item.thumbnail?.contents
      const thumbnails = Array.isArray(rawThumbnails) ? rawThumbnails : []
      for (const thumbnail of thumbnails) {
        try {
          const url = new URL(thumbnail.url)
          if (url.protocol === 'https:' && (url.hostname === 'ytimg.com' || url.hostname.endsWith('.ytimg.com') || url.hostname.endsWith('.googleusercontent.com'))) artwork = url.href
        } catch { /* Fall back to the YouTube video thumbnail. */ }
      }
      results.push({
        id, title, artist: artist || item.author?.name || '',
        album: typeof item.album?.name === 'string' ? item.album.name : '',
        duration: typeof item.duration?.text === 'string' ? item.duration.text : '',
        artwork, kind: item.item_type,
      })
    }
  }
  return results
}

module.exports = { parseMusicSearchResults }
