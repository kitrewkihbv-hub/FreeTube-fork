// Keep one loopback listener only while at least one app window is in Music.
function createMusicControlLifecycle(startServer) {
  let wanted = false
  let server = null
  let phase = 'stopped'

  function begin() {
    if (!wanted || phase !== 'stopped') return
    phase = 'starting'
    server = startServer()
    const current = server
    current.once('listening', () => {
      if (server !== current) return
      phase = 'listening'
      if (!wanted) close()
    })
    current.once('error', () => {
      if (server === current && phase === 'starting') {
        server = null
        phase = wanted ? 'failed' : 'stopped'
      }
    })
  }

  function close() {
    if (!server || phase === 'closing') return
    if (phase === 'starting') return // close once the listen attempt resolves
    const current = server
    phase = 'closing'
    current.close(() => {
      if (server !== current) return
      server = null
      phase = 'stopped'
      if (wanted) begin()
    })
  }

  function setActive(value) {
    wanted = Boolean(value)
    if (!wanted) {
      if (phase === 'failed') phase = 'stopped'
      else close()
    } else if (phase === 'stopped') {
      begin()
    }
  }

  return { setActive, getPhase: () => phase }
}

module.exports = { createMusicControlLifecycle }
