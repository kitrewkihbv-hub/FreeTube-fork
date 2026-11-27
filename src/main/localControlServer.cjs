// The intentionally unauthenticated local widget interface. See README for its
// cross-origin and privacy implications. No credentials or browsing history are exposed.
const http = require('node:http')

function startLocalControlServer({ getStatus, onCommand, port = 8765, logError = console.error }) {
  const commands = new Set(['/prev', '/next', '/toggle', '/shuffle'])
  const server = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    // Reject DNS-rebinding hostnames. Direct loopback and localhost remain usable.
    const host = (request.headers.host || '').toLowerCase()
    const allowedHosts = new Set([`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`])
    if (!allowedHosts.has(host)) {
      response.writeHead(403).end(JSON.stringify({ error: 'Forbidden host' }))
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const pathname = (request.url || '').split('?')[0]
    try {
      if (pathname === '/status') {
        response.end(JSON.stringify(getStatus()))
      } else if (commands.has(pathname)) {
        onCommand(pathname.slice(1))
        response.end(JSON.stringify({ ok: true }))
      } else {
        response.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
      }
    } catch (error) {
      logError(`MacTube local control API request failed: ${error.message}`)
      response.writeHead(500).end(JSON.stringify({ error: 'Player unavailable' }))
    }
  })
  server.on('error', error => logError(`MacTube local control API could not start: ${error.message}`))
  server.listen(port, '127.0.0.1')
  return server
}

module.exports = { startLocalControlServer }
