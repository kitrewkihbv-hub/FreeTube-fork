const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync, execSync } = require('node:child_process')

const source = fs.readFileSync('integrations/ubersicht/dynamic-island.jsx', 'utf8')
const match = source.match(/export const command = (`[\s\S]*?`);/)
assert.ok(match)
const script = vm.runInNewContext(match[1])
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'island-widget-test-'))
const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
const fake = (name, text) => { const file = path.join(bin, name); fs.writeFileSync(file, `#!/bin/sh\n${text}\n`, { mode: 0o755 }) }
try {
  fake('osascript', 'printf "%s" "$FAKE_SPOTIFY"')
  fake('cat', 'printf "%s" "$FAKE_MACTUBE"')
  fake('swift', 'echo 0')
  fake('lsappinfo', 'printf \'1) "Messages"\\n "StatusLabel" "label"="2"\\n\'')
  const runStatus = (spotify, mactube) => execFileSync('/bin/sh', ['-c', script], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_SPOTIFY: spotify, FAKE_MACTUBE: mactube }
  }).trim()
  const mac = 'PAUSED|Video|MACTUBE|https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg'
  const spotify = 'PLAYING|Song|Artist|https://example.com/art'
  assert.equal(runStatus(spotify, mac), `${mac}|MACTUBE|2|0|Messages|0`, 'MacTube video is not hidden by an open Spotify app')
  assert.equal(runStatus(spotify, 'PLAYING|Subscriptions|MACTUBE|'), `${spotify}|SPOTIFY|2|0|Messages|0`, 'ordinary MacTube pages are not videos')
  assert.equal(runStatus('', ''), 'IDLE|SPOTIFY|STANDBY||NONE|2|0|Messages|0')

  const a = source.indexOf('  const act = (e, k) => {')
  const b = source.indexOf('  const bg =', a)
  assert.ok(a >= 0 && b > a)
  const makeAct = vm.runInNewContext(`(source, app, dispatch, run) => { ${source.slice(a, b)}; return act }`)
  const sent = []
  const event = { stopPropagation() {} }
  const macAct = makeAct('MACTUBE', '', () => {}, cmd => sent.push(cmd))
  for (const k of ['PLAY', 'NEXT', 'PREV', 'OPEN_MEDIA']) macAct(event, k)
  assert.match(sent[0], /mactube_cmd\.txt.*PLAY$/)
  assert.match(sent[1], /mactube_cmd\.txt.*NEXT$/)
  assert.match(sent[2], /mactube_cmd\.txt.*PREV$/)
  assert.equal(sent[3], 'open -a "MacTube"')
  // Run the actual publisher against a temporary mailbox and an existing
  // symlink: it must replace the symlink rather than writing through it.
  const target = path.join(dir, 'target'), mailbox = path.join(dir, 'command')
  fs.writeFileSync(target, 'untouched'); fs.symlinkSync(target, mailbox)
  const isolated = sent[0].replace('dir="/tmp"', `dir="${dir}"`).replace('/tmp/mactube_cmd.txt', mailbox)
  execSync(isolated)
  assert.equal(fs.readFileSync(mailbox, 'utf8'), 'PLAY')
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched')

  const spotifyCalls = []
  const spotifyAct = makeAct('SPOTIFY', '', () => {}, cmd => spotifyCalls.push(cmd))
  for (const k of ['PLAY', 'NEXT', 'PREV', 'OPEN_MEDIA']) spotifyAct(event, k)
  assert.deepEqual(spotifyCalls, [
    `osascript -e 'tell application "Spotify" to playpause'`,
    `osascript -e 'tell application "Spotify" to next track'`,
    `osascript -e 'tell application "Spotify" to previous track'`,
    'open -a "Spotify"'
  ])
  const bad = path.join(dir, 'injected')
  const quoted = []
  makeAct('NONE', `A'; touch ${bad}; echo '`, () => {}, cmd => quoted.push(cmd))(event, 'OPEN_APP')
  fake('open', 'exit 0')
  execSync(quoted[0], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(fs.existsSync(bad), false, 'app names cannot inject shell commands')
  console.log('Übersicht widget routing tests passed')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
