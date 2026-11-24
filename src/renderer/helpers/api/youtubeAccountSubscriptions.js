/**
 * Extract subscribed channels from the TV subscription tabs used by SmartTube.
 * The YouTube channel ID is embedded in the protobuf-style browse params; accept
 * only the observed field structure and a normal 24-character channel ID.
 * The tabs can be incomplete, so callers must not treat them as a full export.
 * @param {unknown} response
 * @returns {{ id: string, name: string, thumbnail: string }[]}
 */
export function getYouTubeAccountSubscriptionTabs(response) {
  const data = response?.data ?? response
  const sections = data?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections
  if (!Array.isArray(sections)) return []

  const channels = []
  for (const section of sections) {
    const tabs = section?.tvSecondaryNavSectionRenderer?.tabs
    if (!Array.isArray(tabs)) continue

    for (const item of tabs) {
      const tab = item?.tabRenderer
      const endpoint = tab?.endpoint?.browseEndpoint
      const thumbnail = tab?.thumbnail?.thumbnails?.at(-1)?.url
      if (endpoint?.browseId !== 'FEsubscriptions' || !thumbnail || typeof tab.title !== 'string') continue

      try {
        const encoded = decodeURIComponent(endpoint.params)
        const decoded = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))
        // Observed FEsubscriptions channel tab: field 49 contains field 1,
        // a length-delimited 24-byte channel ID. Reject all other payloads.
        const prefix = String.fromCharCode(0x8a, 0x03, 0x1a, 0x0a, 0x18)
        const id = decoded.slice(prefix.length)
        if (decoded.startsWith(prefix) && /^UC[A-Za-z0-9_-]{22}$/.test(id) && tab.title.trim()) {
          channels.push({ id, name: tab.title.trim(), thumbnail })
        }
      } catch {
        // Ignore unknown tab parameters rather than importing the wrong channel.
      }
    }
  }
  return channels
}
