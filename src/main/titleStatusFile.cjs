const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

function getVideoId(url) {
  try {
    const parsed = new URL(url)
    // Vue's desktop router uses a hash URL, e.g. file:///.../#/watch/VIDEO_ID.
    const route = parsed.hash.startsWith('#/') ? new URL(parsed.hash.slice(1), 'https://app.invalid') : parsed
    const id = route.searchParams.get('v') || route.pathname.match(/(?:^|\/)watch\/([^/]+)/)?.[1]
    return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : ''
  } catch {
    return ''
  }
}

function formatWindowTitle(title, url = '', playing) {
  const clean = String(title || '')
    .replace(/\s*-\s*(MacTube|FreeTube)$/i, '')
    .replace(/[|\r\n]+/g, ' ')
    .trim()
  if (!clean || /^(MacTube|FreeTube)$/i.test(clean)) return 'IDLE|MACTUBE|STANDBY|'
  const videoId = getVideoId(url)
  const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ''
  return `${playing === false ? 'PAUSED' : 'PLAYING'}|${clean}|MACTUBE|${thumbnail}`
}

// The title-file protocol is intentionally independent of the music-only HTTP API.
// Queue updates so that rapid navigation and closing cannot reorder writes.
function createTitleStatusFile({ filename = '/tmp/mactube_np.txt', logError = console.warn } = {}) {
  let queue = Promise.resolve()
  let ownedFile = null
  let stopped = false

  function enqueue(operation) {
    queue = queue.then(operation).catch(error => {
      logError(`MacTube could not update its Übersicht status file (${error.code || 'unknown error'}).`)
    })
    return queue
  }

  function update(title, url, playing) {
    if (stopped) return queue
    const content = formatWindowTitle(title, url, playing)
    return enqueue(async () => {
      const temp = path.join(path.dirname(filename), `.${path.basename(filename)}-${process.pid}-${crypto.randomBytes(12).toString('hex')}`)
      let handle
      try {
        // A fresh exclusive file, followed by an atomic rename, never follows an
        // attacker-supplied symlink at the public /tmp path or leaves partial text.
        handle = await fs.open(temp, 'wx', 0o600)
        await handle.writeFile(content, 'utf8')
        const stat = await handle.stat()
        await handle.close()
        handle = null
        await fs.rename(temp, filename)
        ownedFile = { dev: stat.dev, ino: stat.ino }
      } finally {
        if (handle) await handle.close().catch(() => {})
        await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
    })
  }

  function cleanup() {
    return enqueue(async () => {
      if (!ownedFile) return
      try {
        const stat = await fs.lstat(filename)
        if (stat.isFile() && stat.dev === ownedFile.dev && stat.ino === ownedFile.ino) await fs.unlink(filename)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      } finally {
        ownedFile = null
      }
    })
  }

  function shutdown() {
    stopped = true
    return cleanup()
  }

  return { update, cleanup, shutdown }
}

module.exports = { createTitleStatusFile, formatWindowTitle }
