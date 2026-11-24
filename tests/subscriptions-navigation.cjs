// Mount the real subscriptions view with Vue's in-memory renderer and navigate away/back.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const Vue = require('vue')
const { parse, compileScript } = require('vue/compiler-sfc')

const storeSource = fs.readFileSync('src/renderer/store/modules/youtube-account.js', 'utf8')
  .replace(/^import \{[\s\S]*?\} from '[^']+'\n/, '')
  .replace('export default {', 'globalThis.account = {')
let resolveFeed
let rejectFeed
let calls = 0
const storeContext = vm.createContext({ setYouTubeAccountSubscription: async () => {}, getYouTubeAccountActivityFeed: () => { calls++; return new Promise((resolve, reject) => { resolveFeed = resolve; rejectFeed = reject }) } })
vm.runInContext(storeSource, storeContext)
const accountModule = storeContext.account
accountModule.state = Vue.reactive(accountModule.state)
accountModule.state.youtubeAccount.signedIn = true
const preferences = Vue.reactive({ useAccount: true })
const store = {
  getters: {
    get getIsSignedInToYouTubeAccount() { return accountModule.state.youtubeAccount.signedIn },
    get getUseYouTubeAccountFeed() { return preferences.useAccount },
    get getYouTubeAccountFeed() { return accountModule.state.youtubeAccountFeed },
    get getYouTubeAccountFeedInfo() { return accountModule.state.youtubeAccountFeedInfo },
    getHideSubscriptionsVideos: false,
    getHideSubscriptionsShorts: false,
    getHideSubscriptionsLive: false,
    getHideSubscriptionsCommunity: false,
    getHideLiveStreams: false,
  },
  commit(name, value) { accountModule.mutations[name](accountModule.state, value) },
  dispatch(name, value) {
    if (name === 'updateUseYouTubeAccountFeed') { preferences.useAccount = value; return Promise.resolve() }
    return accountModule.actions[name]({ state: accountModule.state, commit: this.commit.bind(this), dispatch: this.dispatch.bind(this) }, value)
  },
}
const passthrough = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }
const mocks = {
  FontAwesomeIcon: { render: () => null },
  FtCard: passthrough,
  FtFlexBox: passthrough,
  FtButton: { props: ['label'], emits: ['click'], setup: (p, { emit }) => () => Vue.h('button', { onClick: () => emit('click') }, p.label) },
  FtElementList: { props: ['data'], setup: p => () => Vue.h('div', p.data.map(v => v.title).join(',')) },
  FtLoader: { render: () => Vue.h('div', 'Loading') },
  SubscriptionsVideos: { render: () => Vue.h('div', 'LOCAL VIDEOS') },
  SubscriptionsLive: passthrough, SubscriptionsShorts: passthrough, SubscriptionsPosts: passthrough,
}
const source = fs.readFileSync('src/renderer/views/Subscriptions/Subscriptions.vue', 'utf8')
let compiled = compileScript(parse(source, { filename: 'Subscriptions.vue' }).descriptor, { id: 'test', inlineTemplate: true }).content
compiled = compiled.replace(/import \{ ([^}]+) \} from ["']vue["']/g, (_, names) => `const { ${names.replaceAll(' as ', ': ')} } = Vue`)
compiled = compiled.replace(/import \{ FontAwesomeIcon \} from '[^']+'/g, 'const { FontAwesomeIcon } = mocks')
compiled = compiled.replace(/import (\w+) from '[^']+'/g, (_, name) => `const ${name} = ${name === 'store' ? 'storeMock' : `mocks.${name}`}`)
compiled = compiled.replace('export default', 'globalThis.component =')
const sessionValues = new Map()
const componentContext = vm.createContext({ Vue, mocks, storeMock: store, console: { error() {} }, sessionStorage: { getItem: key => sessionValues.get(key) ?? null, setItem: (key, val) => sessionValues.set(key, val), removeItem: key => sessionValues.delete(key) }, window: { setInterval, clearInterval, addEventListener() {}, removeEventListener() {} }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } })
vm.runInContext(compiled, componentContext)
const component = componentContext.component
const renderer = Vue.createRenderer({
  createElement: type => ({ type, children: [], props: {}, text: '' }),
  createText: text => ({ type: '#text', text }),
  createComment: text => ({ type: '#comment', text }),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  parentNode: node => node.parent,
  nextSibling: node => { const a = node.parent?.children ?? []; return a[a.indexOf(node) + 1] ?? null },
  patchProp: (node, key, _old, val) => { node.props[key] = val },
  insert: (node, parent, anchor) => { if (node.parent) { const old = node.parent.children.indexOf(node); if (old >= 0) node.parent.children.splice(old, 1) }; node.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, node) },
  remove: node => { const i = node.parent?.children.indexOf(node) ?? -1; if (i >= 0) node.parent.children.splice(i, 1); node.parent = null },
})
const root = { type: 'root', children: [] }
const mount = () => { const app = renderer.createApp(component); app.config.globalProperties.$t = key => key; app.mount(root); return app }
const text = node => (node.text ?? '') + (node.children ?? []).map(text).join('')
const findButton = (node, label) => node.type === 'button' && node.text === label ? node : (node.children ?? []).map(child => findButton(child, label)).find(Boolean)
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }
;(async () => {
  let app = mount()
  await flush()
  assert.equal(calls, 1)
  // Navigate away while the authenticated request is still pending, then return.
  app.unmount()
  app = mount()
  await flush()
  assert.equal(calls, 1, 'the in-flight request is reused after returning')
  resolveFeed({ videos: [{ type: 'video', videoId: 'one', title: 'ACCOUNT VIDEO' }], source: 'youtube', partial: false })
  await flush()
  assert.match(text(root), /ACCOUNT VIDEO/)
  app.unmount()
  app = mount()
  await flush()
  assert.match(text(root), /ACCOUNT VIDEO/, 'cached account videos remain after returning')
  assert.equal(calls, 1)
  // Manual refresh must start a new request without hiding the old videos.
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  assert.equal(calls, 2)
  assert.match(text(root), /ACCOUNT VIDEO/, 'cached videos stay visible while refreshing')
  resolveFeed({ videos: [{ type: 'video', videoId: 'two', title: 'NEW ACCOUNT VIDEO' }], source: 'youtube', partial: false })
  await flush()
  assert.match(text(root), /NEW ACCOUNT VIDEO/)
  // Returning after the five minute freshness interval triggers a background refresh.
  accountModule.state.youtubeAccountFeedInfo.fetchedAt = Date.now() - 6 * 60 * 1000
  app.unmount()
  app = mount()
  await flush()
  assert.equal(calls, 3)
  assert.match(text(root), /NEW ACCOUNT VIDEO/)
  resolveFeed({ videos: [{ type: 'video', videoId: 'three', title: 'LATEST ACCOUNT VIDEO' }], source: 'youtube', partial: false })
  await flush()
  assert.match(text(root), /LATEST ACCOUNT VIDEO/)
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  assert.equal(calls, 4)
  rejectFeed(new Error('offline'))
  await flush()
  assert.match(text(root), /LATEST ACCOUNT VIDEO/, 'failed refresh preserves cached videos')
  assert.match(text(root), /Subscriptions.YouTube Account Feed Refresh Error/)
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  assert.equal(calls, 5, 'manual refresh retries immediately after an error')
  resolveFeed({ videos: [{ type: 'video', videoId: 'three', title: 'LATEST ACCOUNT VIDEO' }], source: 'youtube', partial: false })
  await flush()
  assert.doesNotMatch(text(root), /Subscriptions.YouTube Account Feed Refresh Error/)
  // A subscription change during a refresh must not reintroduce an old feed.
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  assert.equal(calls, 6)
  const staleRequest = resolveFeed
  await store.dispatch('setYouTubeAccountSubscription', { channelId: 'channel', subscribed: false })
  await flush()
  staleRequest({ videos: [{ type: 'video', videoId: 'stale', title: 'STALE VIDEO' }], source: 'youtube' })
  await flush()
  assert.equal(calls, 7, 'invalidating a running feed triggers a fresh request')
  assert.doesNotMatch(text(root), /STALE VIDEO/)
  resolveFeed({ videos: [{ type: 'video', videoId: 'four', title: 'AFTER UNSUBSCRIBE' }], source: 'youtube' })
  await flush()
  assert.match(text(root), /AFTER UNSUBSCRIBE/)
  // The actual Refresh button must visibly change an unchanged multi-video feed,
  // without changing the cached YouTube order or mixing in non-subscriptions.
  const stableVideos = Array.from({ length: 6 }, (_, index) => ({ type: 'video', videoId: `stable${index}`, title: `SUB VIDEO ${index}`, authorId: 'subscribed' }))
  accountModule.mutations.setYouTubeAccountFeed(accountModule.state, stableVideos)
  await flush()
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  resolveFeed({ videos: stableVideos, source: 'youtube', partial: false })
  await flush()
  assert.match(text(root), /SUB VIDEO 3,SUB VIDEO 4,SUB VIDEO 5,SUB VIDEO 0/, 'unchanged feed is visibly rotated')
  assert.match(text(root), /Subscriptions.Account Feed Rotated/)
  assert.equal(accountModule.state.youtubeAccountFeed[0].videoId, 'stable0', 'YouTube cached order is preserved')
  findButton(root, 'Subscriptions.Restore Feed Order').props.onClick()
  await flush()
  assert.match(text(root), /SUB VIDEO 0,SUB VIDEO 1,SUB VIDEO 2/)
  assert.doesNotMatch(text(root), /Subscriptions.Account Feed Rotated/)
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  resolveFeed({ videos: [{ type: 'video', videoId: 'added', title: 'NEW SUB VIDEO', authorId: 'subscribed' }, ...stableVideos], source: 'youtube' })
  await flush()
  assert.match(text(root), /Subscriptions.Account Feed New Results/)
  assert.match(text(root), /NEW SUB VIDEO,SUB VIDEO 0/, 'newly returned videos retain YouTube order')
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  rejectFeed(new Error('offline'))
  await flush()
  assert.match(text(root), /Subscriptions.YouTube Account Feed Refresh Error/)
  assert.match(text(root), /NEW SUB VIDEO,SUB VIDEO 0/, 'failed request does not rotate or discard videos')
  // A small feed cannot always provide a different item.
  accountModule.mutations.setYouTubeAccountFeed(accountModule.state, [stableVideos[0]])
  await flush()
  findButton(root, 'Subscriptions.Refresh').props.onClick()
  await flush()
  resolveFeed({ videos: [stableVideos[0]], source: 'youtube' })
  await flush()
  assert.match(text(root), /Subscriptions.Account Feed Unchanged/)
  accountModule.mutations.setYouTubeAccountFeed(accountModule.state, [{ type: 'video', videoId: 'four', title: 'AFTER UNSUBSCRIBE' }])
  await flush()
  findButton(root, 'Subscriptions.Switch to Local Feed').props.onClick()
  await flush()
  assert.match(text(root), /LOCAL VIDEOS/)
  app.unmount()
  app = mount()
  await flush()
  assert.match(text(root), /LOCAL VIDEOS/, 'chosen local source survives navigation')
  findButton(root, 'Subscriptions.Switch to YouTube Feed').props.onClick()
  await flush()
  assert.match(text(root), /AFTER UNSUBSCRIBE/, 'switching back restores cached YouTube videos')
  app.unmount()
  console.log('Subscriptions navigation and feed choice tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
