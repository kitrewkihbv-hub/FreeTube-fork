// Offline integration checks for the real Watch methods and the local UI wiring.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const watch = fs.readFileSync('src/renderer/views/Watch/Watch.js', 'utf8')
const start = watch.indexOf('    syncLocalPlayerState() {')
const end = watch.indexOf('    async reloadView(', start)
assert.ok(start > 0 && end > start)
const states = [], calls = []
const context = vm.createContext({
  process: { env: { IS_ELECTRON: true } },
  window: { ftElectron: { updateLocalPlayerState: value => states.push(value) } },
  showToast: () => {}, formatDurationAsTimestamp: String, Number, Math,
})
const methods = vm.runInContext(`({ ${watch.slice(start, end)} })`, context)
const player = { togglePlayback: () => calls.push('toggle'), toggleCaptions: () => true, setCurrentTime: n => calls.push(`seek:${n}`) }
const playlist = { toggleShuffle: () => calls.push('shuffle') }
const instance = {
  ...methods, widgetControlsActive: true, videoPlayerLoaded: true, isLoading: false, errorMessage: null,
  videoTitle: 'Song', channelName: 'Artist', musicPlaying: true, musicShuffle: false, watchingPlaylist: true,
  $refs: { player, watchVideoPlaylist: playlist },
  handleSkipToNext: () => calls.push('next'), handleSkipToPrev: () => calls.push('prev'), t: x => x,
}
instance.syncLocalPlayerState()
assert.deepEqual(JSON.parse(JSON.stringify(states.at(-1))), { title: 'Song', artist: 'Artist', playing: true, shuffle: false })
for (const command of ['toggle', 'next', 'prev', 'shuffle']) instance.handleLocalPlayerCommand(command)
assert.deepEqual(calls, ['toggle', 'next', 'prev', 'shuffle'])
instance.musicShuffle = true
instance.musicPlaying = false
instance.syncLocalPlayerState()
assert.equal(states.at(-1).shuffle, true)
assert.equal(states.at(-1).playing, false)
instance.watchingPlaylist = false
instance.syncLocalPlayerState()
assert.equal(states.at(-1).shuffle, false, 'shuffle only represents a real playlist shuffle')
instance.isLoading = true
instance.syncLocalPlayerState()
assert.equal(states.at(-1), null)
instance.handleLocalPlayerCommand('toggle')
assert.equal(calls.length, 4, 'commands do nothing while the player is loading')
instance.widgetControlsActive = false
instance.syncLocalPlayerState()
assert.equal(states.length, 4, 'a leaving view cannot republish stale state')

const playerSource = fs.readFileSync('src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', 'utf8')
const playlistSource = fs.readFileSync('src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', 'utf8')
const template = fs.readFileSync('src/renderer/views/Watch/Watch.vue', 'utf8')
assert.match(playerSource, /emit\('playback-state-changed', true\)/)
assert.match(playerSource, /emit\('playback-state-changed', false\)/)
assert.match(playlistSource, /watch\(shuffleEnabled, value => emit\('shuffle-changed', value\)\)/)
assert.match(template, /@playback-state-changed="musicPlaying = \$event"/)
assert.match(template, /@shuffle-changed="musicShuffle = \$event"/)
assert.match(fs.readFileSync('src/renderer/components/FtListVideo/FtListVideo.vue', 'utf8'), /route\.query\.music === '1'/)
console.log('Music player and widget wiring tests passed')
