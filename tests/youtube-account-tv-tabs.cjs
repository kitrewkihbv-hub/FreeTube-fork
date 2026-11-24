// Synthetic subscription tabs using the structure seen in SmartTube's all_channels fixture.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/renderer/helpers/api/youtubeAccountSubscriptions.js', 'utf8')
  .replace('export function', 'function')
const parse = vm.runInNewContext(`(${source})`, { atob, decodeURIComponent })
const id = 'UC1234567890123456789012'
const params = encodeURIComponent(Buffer.concat([Buffer.from([0x8a, 3, 0x1a, 0x0a, 0x18]), Buffer.from(id)]).toString('base64'))
const tab = (endpoint, title = 'Channel', thumbnail = true) => ({ tabRenderer: {
  title,
  endpoint: { browseEndpoint: endpoint },
  ...(thumbnail ? { thumbnail: { thumbnails: [{ url: 'https://example.com/avatar' }] } } : {}),
} })
const response = { contents: { tvBrowseRenderer: { content: { tvSecondaryNavRenderer: { sections: [
  { tvSecondaryNavSectionRenderer: { tabs: [
    tab({ browseId: 'FEsubscriptions', params }, 'The channel'),
    tab({ browseId: 'FEsubscriptions', params: 'igMA' }, 'All', false),
    tab({ browseId: 'FEsubscriptions', params: '%ZZ' }),
    tab({ browseId: 'FEother', params }),
    tab({ browseId: 'FEsubscriptions', params: encodeURIComponent(Buffer.from('fake' + id).toString('base64')) }),
  ] } }
] } } } } }
const channels = parse(response)
assert.equal(channels.length, 1)
assert.equal(channels[0].id, id)
assert.equal(channels[0].name, 'The channel')
assert.equal(parse({}).length, 0)
console.log('TV subscription tab tests passed')
