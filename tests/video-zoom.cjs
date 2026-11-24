// Exercise the player button's accessible expanded state and toggle.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/components/FtShakaVideoPlayer/player-components/VideoZoomButton.js', 'utf8')
  .replace(/^import .*$/gm, '').replace('export class', 'class')
const button = { classList: { add() {} }, setAttribute(k, v) { this[k] = v } }
const listeners = {}
const parent = { appendChild(child) { assert.equal(child, button) } }
const events = {}
const context = { document: { createElement: () => button }, shaka: { ui: { Element: class { constructor() { this.eventManager = { listen: (_, name, fn) => { listeners[name] = fn } } } } } }, i18n: { global: { t: () => 'Adjust picture' } } }
const Button = vm.runInNewContext(`${source}\nVideoZoomButton`, context)
let opened = false
new Button(() => opened, () => { opened = !opened; listeners.videoAdjustmentsChanged() }, 'panel', events, parent, {})
assert.equal(button['aria-controls'], 'panel')
assert.equal(button['aria-expanded'], 'false')
listeners.click()
assert.equal(button['aria-expanded'], 'true')
listeners.click()
assert.equal(button['aria-expanded'], 'false')
const vue = fs.readFileSync('src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', 'utf8')
assert.match(vue, /scale\(\$\{videoWidth \/ 100\}, \$\{videoHeight \/ 100\}\)/)
assert.match(vue, /videoWidth\.value = 100/)
assert.match(vue, /videoHeight\.value = 100/)
console.log('Picture adjustment control tests passed')
