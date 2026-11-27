const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')

// Claim each command by moving it into a private directory before reading it.
// This prevents following a symlink at the shared path and avoids deleting a
// newer command written after the claim. The protocol is a single-slot mailbox:
// multiple writes before a poll can overwrite one another.
function createDynamicIslandCommands({ filename = '/tmp/mactube_cmd.txt', onCommand, canPoll = () => true, interval = 300, logError = console.warn } = {}) {
  let stopped = false
  let busy = false
  let privateDir

  async function poll() {
    if (stopped || busy || !canPoll()) return
    busy = true
    let claimed
    try {
      if (!privateDir) privateDir = await fs.mkdtemp(path.join(path.dirname(filename), '.mactube-commands-'))
      claimed = path.join(privateDir, 'command')
      // Never intentionally move directories out of the shared location.
      const source = await fs.lstat(filename)
      if (source.isDirectory()) return
      await fs.rename(filename, claimed)
      const entry = await fs.lstat(claimed)
      if (!entry.isFile() || entry.size > 64 || (typeof process.getuid === 'function' && entry.uid !== process.getuid())) return
      let handle
      try {
        handle = await fs.open(claimed, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
        const stat = await handle.stat()
        if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino || stat.size > 64) return
        const buffer = Buffer.alloc(65)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        const command = buffer.subarray(0, bytesRead).toString('utf8').trim()
        if (!stopped && bytesRead <= 64 && ['PLAY', 'NEXT', 'PREV'].includes(command)) onCommand(command)
      } finally {
        await handle?.close()
      }
    } catch (error) {
      if (error.code !== 'ENOENT') logError(`MacTube command file error (${error.code || 'unknown error'}).`)
    } finally {
      if (claimed) {
        try {
          const stat = await fs.lstat(claimed)
          // A directory is never traversed, even if a malicious rename raced us.
          if (stat.isDirectory()) await fs.rmdir(claimed)
          else await fs.unlink(claimed)
        } catch (error) {
          if (error.code !== 'ENOENT') logError(`MacTube command cleanup error (${error.code || 'unknown error'}).`)
        }
      }
      busy = false
      if (stopped && privateDir) await fs.rmdir(privateDir).catch(() => {})
    }
  }

  const timer = setInterval(poll, interval)
  function stop() {
    stopped = true
    clearInterval(timer)
    if (!busy && privateDir) fs.rmdir(privateDir).catch(() => {})
  }
  return { poll, stop }
}

module.exports = { createDynamicIslandCommands }
