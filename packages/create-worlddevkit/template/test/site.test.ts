import assert from 'node:assert/strict'
import test from 'node:test'

process.env.WORLD_URL = 'https://starter.world'
const { handleRequest } = await import('../src/app.js')

const get = (path: string) => handleRequest(new Request(new URL(path, 'https://starter.world')))

test('the home page is the website, not a 404', async () => {
  const response = await get('/')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  assert.match(await response.text(), /<main id="main"/)
})

test('the website assets load', async () => {
  for (const path of ['/app.js', '/styles.css']) {
    const response = await get(path)
    assert.equal(response.status, 200, path)
  }
})

test('client-side routes load the website', async () => {
  const response = await get('/places/central-garden')
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
})

test('protocol paths still reach the API', async () => {
  const discovery = await get('/.well-known/world.json')
  assert.equal(discovery.status, 200)
  assert.equal((await discovery.json() as { id: string }).id, 'https://starter.world')
  const missing = await get('/api/world/v0/entities/wp%3Aplace/does-not-exist')
  assert.equal(missing.status, 404)
  assert.equal((await missing.json() as { code: string }).code, 'entity_not_found')
})

test('files outside public/ are never served', async () => {
  for (const path of ['/%2e%2e/package.json', '/..%2fpackage.json', '/../src/world.ts']) {
    const response = await get(path)
    assert.equal(response.status, 404, path)
  }
})
