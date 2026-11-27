const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createDynamicIslandCommands } = require('../src/main/dynamicIslandCommands.cjs')

;(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mactube-island-test-'))
  const filename = path.join(dir, 'mactube_cmd.txt')
  const target = path.join(dir, 'target')
  const received = [], errors = []
  let active = true
  const listener = createDynamicIslandCommands({ filename, onCommand: command => received.push(command), canPoll: () => active, interval: 60000, logError: message => errors.push(message) })
  try {
    await listener.poll()
    await fs.writeFile(filename, ' PLAY\n')
    active = false
    await listener.poll()
    assert.equal(await fs.readFile(filename, 'utf8'), ' PLAY\n')
    active = true
    await listener.poll()
    assert.deepEqual(received, ['PLAY'])
    await assert.rejects(fs.stat(filename), { code: 'ENOENT' })
    for (const command of ['NEXT', 'PREV', 'INVALID', 'x'.repeat(100)]) {
      await fs.writeFile(filename, command)
      await listener.poll()
    }
    assert.deepEqual(received, ['PLAY', 'NEXT', 'PREV'])
    await fs.writeFile(target, 'PLAY')
    await fs.symlink(target, filename)
    await listener.poll()
    assert.equal(await fs.readFile(target, 'utf8'), 'PLAY')
    assert.deepEqual(received, ['PLAY', 'NEXT', 'PREV'])
    // A widget can publish the next command while the previous claim is handled.
    const newer = createDynamicIslandCommands({ filename, interval: 60000, onCommand: () => require('node:fs').writeFileSync(filename, 'NEXT') })
    await fs.writeFile(filename, 'PLAY')
    await newer.poll()
    newer.stop()
    assert.equal(await fs.readFile(filename, 'utf8'), 'NEXT')
    await listener.poll()
    assert.deepEqual(received, ['PLAY', 'NEXT', 'PREV', 'NEXT'])
    await fs.mkdir(filename)
    await listener.poll()
    assert.ok((await fs.stat(filename)).isDirectory())
    await fs.rmdir(filename)
    listener.stop()
    await fs.writeFile(filename, 'PLAY')
    await listener.poll()
    assert.deepEqual(received, ['PLAY', 'NEXT', 'PREV', 'NEXT'])
    assert.deepEqual(errors, [])

    // Exercise the actual Watch methods, independently of the Music-only API.
    const code = await fs.readFile('src/renderer/views/Watch/Watch.js', 'utf8')
    const start = code.indexOf('    handleDynamicIslandCommand(command) {')
    const end = code.indexOf('    toggleMusicPlayback()', start)
    assert.ok(start >= 0 && end > start)
    const handler = vm.runInNewContext(`({${code.slice(start, end)}}).handleDynamicIslandCommand`)
    const actions = []
    let time = 8
    const view = { videoPlayerLoaded: true, isLoading: false, errorMessage: '', watchingPlaylist: false,
      $refs: { player: { togglePlayback: () => actions.push('toggle'), getCurrentTime: () => time, setCurrentTime: n => actions.push(`seek:${n}`) } },
      handleSkipToNext: () => actions.push('next'), handleSkipToPrev: () => actions.push('prev'), $router: { back: () => actions.push('back') } }
    handler.call(view, 'PLAY'); handler.call(view, 'NEXT'); handler.call(view, 'PREV')
    time = 3; view.watchingPlaylist = true; handler.call(view, 'PREV')
    view.watchingPlaylist = false; handler.call(view, 'PREV')
    view.isLoading = true; handler.call(view, 'PLAY')
    assert.deepEqual(actions, ['toggle', 'next', 'seek:0', 'prev', 'back'])
    assert.match(code, /stopDynamicIslandControls\?\.\(\)/)
    console.log('Dynamic Island command tests passed')
  } finally {
    listener.stop()
    await fs.rm(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
