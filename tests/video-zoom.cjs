// Exercise the actual control class without a browser or a playing video.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/components/FtShakaVideoPlayer/player-components/VideoZoomButton.js', 'utf8')
  .replace(/^import .*$/gm, '').replace('export class', 'class')
const button = { classList: { add() {} }, setAttribute(k, v) { this[k] = v }, getAttribute(k) { return this[k] } }
const parent = { appendChild(child) { assert.equal(child, button) } }
const context = { document: { createElement: () => button }, shaka: { ui: { Element: class { constructor() { this.eventManager = { listen: (_, __, fn) => { button.click = fn } } } } } }, i18n: { global: { t: (key, { zoom }) => `${key} ${zoom}%` } } }
const Button = vm.runInNewContext(`${source}\nVideoZoomButton`, context)
let zoom = 100
new Button(() => zoom, value => { zoom = value }, parent, {})
assert.match(button.textContent, /100%/)
for (const value of [125, 150, 200, 100]) {
  button.click()
  assert.equal(zoom, value)
  assert.match(button['aria-label'], new RegExp(`${value}%`))
}
console.log('Video zoom control tests passed')
