// Mount the actual Discover view and click its refresh button with paginated results.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const Vue = require('vue')
const { parse, compileScript } = require('vue/compiler-sfc')

const helper = fs.readFileSync('src/renderer/helpers/api/discoveryFeed.js', 'utf8').replaceAll('export function', 'function')
const helperContext = vm.createContext({ setTimeout, clearTimeout })
vm.runInContext(`${helper}\nglobalThis.discovery = { createDiscoveryBrowser, createInterestSearch }`, helperContext)
const discovery = helperContext.discovery
const history = [{ videoId: 'watched', title: 'My favorite games', authorId: 'creator' }]
const storeMock = { getters: { getYouTubeAccount: { signedIn: true, channelId: 'user' }, getShowFamilyFriendlyOnly: false, getHistoryCacheSorted: history } }
const video = (prefix, n) => ({ type: 'video', videoId: `${prefix}${n}`, title: `${prefix} video ${n}` })
let freshSearches = 0, continuationCalls = 0
const api = {
  openDiscoveryFeed: async (_kind, _safety, signedIn) => { assert.equal(signedIn, true); return { videos: [video('home', 1)], has_continuation: false } },
  getLocalSearchResults: async query => {
    assert.equal(query, 'My favorite games')
    freshSearches++
    return { results: Array.from({ length: 15 }, (_, n) => video('old', n)), continuationData: 'page2' }
  },
  getLocalSearchContinuation: async token => {
    assert.equal(token, 'page2')
    continuationCalls++
    return { results: Array.from({ length: 15 }, (_, n) => video('new', n)), continuationData: null }
  },
}
const passthrough = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }
const mocks = {
  FontAwesomeIcon: { render: () => null }, FtCard: passthrough,
  FtButton: { props: ['label'], emits: ['click'], setup: (p, { emit }) => () => Vue.h('button', { onClick: () => emit('click') }, p.label) },
  FtElementList: { props: ['data'], setup: p => () => Vue.h('div', p.data.map(v => v.title).join(',')) },
  FtLoader: { render: () => Vue.h('div', 'Loading') },
}
const source = fs.readFileSync('src/renderer/views/Discovery/Discovery.vue', 'utf8')
let compiled = compileScript(parse(source, { filename: 'Discovery.vue' }).descriptor, { id: 'test', inlineTemplate: true }).content
compiled = compiled.replace(/import \{ ([^}]+) \} from ["']vue["']/g, (_, names) => `const { ${names.replaceAll(' as ', ': ')} } = Vue`)
compiled = compiled.replace(/import \{ FontAwesomeIcon \} from '[^']+'/g, 'const { FontAwesomeIcon } = mocks')
compiled = compiled.replace(/import \{ getLocalSearchContinuation, getLocalSearchResults, openDiscoveryFeed \} from '[^']+'/g, 'const { getLocalSearchContinuation, getLocalSearchResults, openDiscoveryFeed } = api')
compiled = compiled.replace(/import \{ createDiscoveryBrowser, createInterestSearch \} from '[^']+'/g, 'const { createDiscoveryBrowser, createInterestSearch } = discovery')
compiled = compiled.replace(/import (\w+) from '[^']+'/g, (_, name) => `const ${name} = ${name === 'store' ? 'storeMock' : `mocks.${name}`}`)
compiled = compiled.replace('export default', 'globalThis.component =')
const context = vm.createContext({ Vue, mocks, storeMock, api, discovery, console })
vm.runInContext(compiled, context)
const renderer = Vue.createRenderer({
  createElement: type => ({ type, children: [], props: {}, text: '' }),
  createText: text => ({ type: '#text', text }),
  createComment: text => ({ type: '#comment', text }),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  parentNode: node => node.parent,
  nextSibling: node => { const a = node.parent?.children ?? []; return a[a.indexOf(node) + 1] ?? null },
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  insert: (node, parent, anchor) => { if (node.parent) { const old = node.parent.children.indexOf(node); if (old >= 0) node.parent.children.splice(old, 1) }; node.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, node) },
  remove: node => { const i = node.parent?.children.indexOf(node) ?? -1; if (i >= 0) node.parent.children.splice(i, 1) },
})
const text = node => (node.text ?? '') + (node.children ?? []).map(text).join('')
const findButton = node => node.type === 'button' && node.text === 'Discovery.Refresh' ? node : (node.children ?? []).map(findButton).find(Boolean)
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }
;(async () => {
  const root = { type: 'root', children: [] }
  const app = renderer.createApp(context.component)
  app.config.globalProperties.$t = key => key
  app.mount(root)
  await flush()
  assert.match(text(root), /old video 0/)
  findButton(root).props.onClick()
  await flush()
  assert.equal(freshSearches, 1)
  assert.equal(continuationCalls, 1)
  assert.match(text(root), /new video 0/, 'clicking Refresh displays new related videos')
  app.unmount()
  console.log('Discover refresh UI test passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
