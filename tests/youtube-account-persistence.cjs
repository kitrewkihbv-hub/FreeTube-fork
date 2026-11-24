// Tests real account storage with mocked Electron safeStorage and app readiness.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync('src/main/youtubeAccount.js', 'utf8')
  .replace(/^import .*\n/gm, '')
  .replaceAll('export ', '')

function createAccount(ready) {
  const context = vm.createContext({
    app: { whenReady: () => ready },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text),
      decryptString: (data) => data.toString(),
    },
    existsSync: fs.existsSync,
    asyncFs: fsp,
    path,
    Buffer,
    console,
    AbortController,
    fetch: async () => ({ ok: true }),
    setTimeout,
    clearTimeout,
  })
  vm.runInContext(source, context)
  return context
}

;(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mactube-session-test-'))
  const accountFile = path.join(dir, 'youtube-account.json')
  const tokens = { access_token: 'old', refresh_token: 'refresh', expiry_date: 'later' }
  const state = { tokens, name: 'Example' }
  await fsp.writeFile(accountFile, JSON.stringify({ encrypted: true, data: Buffer.from(JSON.stringify(state)).toString('base64') }))

  let signalReady
  const ready = new Promise(resolve => { signalReady = resolve })
  const account = createAccount(ready)
  account.initYoutubeAccount(dir)
  const loading = account.loadAccountState()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(account.getAccountState().isSignedIn, false, 'should not touch secure storage before app ready')
  signalReady()
  await loading
  assert.equal((await account.getLoadedAccountState()).name, 'Example')
  assert.equal(account.getAccountTokens().refresh_token, 'refresh')

  account.updateAccountInfo({ name: 'Updated' })
  await account.updateAccountTokens({ ...tokens, access_token: 'new' })
  const restored = createAccount(Promise.resolve())
  restored.initYoutubeAccount(dir)
  await restored.loadAccountState()
  assert.equal(restored.getAccountState().name, 'Updated')
  assert.equal(restored.getAccountTokens().access_token, 'new')

  const pending = account.updateAccountTokens({ ...tokens, access_token: 'last' })
  await account.signOut()
  await pending
  assert.equal(fs.existsSync(accountFile), false, 'pending saves must not resurrect a signed-out session')
  await fsp.rm(dir, { recursive: true, force: true })
  console.log('Account persistence tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
