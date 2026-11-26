const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { startLocalControlServer } = require('../src/main/localControlServer.cjs')

const request = (port, path, options = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, ...options }, res => {
    let body = ''
    res.on('data', chunk => { body += chunk })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
  })
  req.on('error', reject)
  req.end()
})

;(async () => {
  let status = { title: '', artist: '', playing: false, shuffle: false }
  const commands = []
  const server = startLocalControlServer({
    port: 0, getStatus: () => status, onCommand: command => { commands.push(command) }
  })
  await once(server, 'listening')
  try {
    const { address, port } = server.address()
    assert.equal(address, '127.0.0.1')
    let result = await request(port, '/status')
    assert.equal(result.status, 200)
    assert.deepEqual(JSON.parse(result.body), status)
    assert.equal(result.headers['access-control-allow-origin'], '*')
    assert.equal(result.headers['cache-control'], 'no-store')
    status = { title: 'Song', artist: 'Channel', playing: true, shuffle: true }
    result = await request(port, '/status')
    assert.deepEqual(JSON.parse(result.body), status)
    for (const name of ['prev', 'next', 'toggle', 'shuffle']) {
      result = await request(port, `/${name}?widget=1`)
      assert.equal(result.status, 200)
      assert.deepEqual(JSON.parse(result.body), { ok: true })
    }
    assert.deepEqual(commands, ['prev', 'next', 'toggle', 'shuffle'])
    assert.equal((await request(port, '/status', { method: 'OPTIONS' })).status, 204)
    assert.equal((await request(port, '/toggle', { method: 'POST' })).status, 405)
    assert.equal((await request(port, '/no-such-route')).status, 404)
    assert.equal((await request(port, '/status', { headers: { host: `evil.example:${port}` } })).status, 403)
    assert.equal((await request(port, '/status', { headers: { host: `localhost:${port}` } })).status, 200)

    let logged = ''
    const conflict = startLocalControlServer({ port, getStatus: () => status, onCommand() {}, logError: message => { logged = message } })
    await once(conflict, 'error').catch(() => {})
    assert.match(logged, /could not start/i, 'occupied port logs an error without crashing')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
  console.log('Local widget HTTP server tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
