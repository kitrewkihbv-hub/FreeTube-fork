const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter, once } = require('node:events')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createWidgetPlayerRegistry, startWidgetPlayerBridge } = require('../src/main/widgetPlayerBridge.cjs')
const run = promisify(execFile)
const source = fs.readFileSync('integrations/ubersicht/dynamic-island-new-mactube.jsx', 'utf8')
const shellStart = source.indexOf('const BROWSERS = '), shellEnd = source.indexOf('/* ───────────────────────── TIMER PERSISTENCE', shellStart)
const shell = vm.runInNewContext(`(()=>{${source.slice(shellStart, shellEnd).replace('export const command =', 'const command =')};return command})()`)
const parseStart = source.indexOf('const setT = '), parseEnd = source.indexOf('const ingestBT = ', parseStart)
const ingest = vm.runInNewContext(`(()=>{${source.slice(parseStart, parseEnd)};return ingest})()`, {
  atob: value => Buffer.from(value, 'base64').toString('binary'), decodeURIComponent,
  fetchMusicArt() {}, fetchRemoteArt() {}, Date, Number, Array, JSON,
})
class Sender extends EventEmitter { constructor(id) { super(); this.id = id } isDestroyed() { return false } }
const state = mode => ({ mode, videoId: 'abcdefghijk', title: 'Café 🌊', artist: 'Creator', playing: true, duration: 120, position: 8 })
;(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mactube-integration-'))
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin)
  for (const [name, script] of [['pgrep', 'exit 1'], ['pmset', 'exit 0'], ['osascript', 'exit 0']]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  }
  const registry = createWidgetPlayerRegistry(() => {})
  const server = startWidgetPlayerBridge({ registry, dispatch() {}, port: 0 })
  await once(server, 'listening')
  const port = server.address().port
  const poll = async () => (await run('/bin/sh', ['-c', shell.replaceAll('127.0.0.1:8766', `127.0.0.1:${port}`)], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })).stdout
  const initial = { battery: { pct: null, ac: null }, volume: null, muted: false, music: null, art: {}, transient: null }
  try {
    const sender = new Sender(1)
    registry.setPlayer(sender, state('video'))
    let displayed = ingest(initial, await poll())
    assert.equal(displayed.music?.app, 'mactube'); assert.equal(displayed.music.mode, 'video')
    assert.equal(displayed.music.title, 'Café 🌊'); assert.equal(displayed.music.playing, true)
    registry.setPlayer(sender, state('music'))
    displayed = ingest(initial, await poll())
    assert.equal(displayed.music?.app, 'mactube'); assert.equal(displayed.music.mode, 'music')
    assert.equal(displayed.music.title, 'Café 🌊'); assert.equal(displayed.music.pos, 8)
    registry.setPlayer(sender, null)
    displayed = ingest(initial, await poll())
    assert.equal(displayed.music, null)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(temp, { recursive: true, force: true })
  }
  console.log('Widget polling through the real bridge passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
