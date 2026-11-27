// Keep the legacy Music API separate from the local Spotify-style adapter,
// which also follows ordinary loaded Watch players.
function createLocalPlayerRegistry({ setServerActive }) {
  const players = new Map()
  const musicWindows = new Set()
  const tracked = new WeakSet()
  let sequence = 0

  function refreshServer() { setServerActive(musicWindows.size > 0 || players.size > 0) }
  function forget(sender) {
    players.delete(sender.id)
    musicWindows.delete(sender.id)
    refreshServer()
  }
  function track(sender) {
    if (tracked.has(sender)) return
    tracked.add(sender)
    sender.once('destroyed', () => forget(sender))
    sender.on('render-process-gone', () => forget(sender))
    sender.on('did-start-navigation', (_, __, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) forget(sender)
    })
  }
  function setMusic(sender, active) {
    track(sender)
    if (active === true) musicWindows.add(sender.id)
    else musicWindows.delete(sender.id)
    refreshServer()
  }
  function setPlayer(sender, value) {
    track(sender)
    if (!value || typeof value.title !== 'string' || !value.title) {
      players.delete(sender.id)
    } else {
      players.set(sender.id, {
        sender,
        sequence: ++sequence,
        state: {
          title: value.title.slice(0, 500),
          artist: typeof value.artist === 'string' ? value.artist.slice(0, 500) : '',
          playing: value.playing === true,
          shuffle: value.shuffle === true,
          videoId: typeof value.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.videoId) ? value.videoId : '',
          durationMs: Number.isFinite(value.durationMs) ? Math.max(0, Math.min(value.durationMs, 604800000)) : 0,
          progressMs: Number.isFinite(value.progressMs) ? Math.max(0, Math.min(value.progressMs, 604800000)) : 0,
        }
      })
    }
    refreshServer()
  }
  function activePlayer(musicOnly = false) {
    return [...players.values()]
      .filter(entry => (!musicOnly || musicWindows.has(entry.sender.id)) && !entry.sender.isDestroyed())
      .sort((a, b) => Number(b.state.playing) - Number(a.state.playing) || b.sequence - a.sequence)[0]
  }
  return { setMusic, setPlayer, activePlayer, hasMusic: () => musicWindows.size > 0 }
}
module.exports = { createLocalPlayerRegistry }
