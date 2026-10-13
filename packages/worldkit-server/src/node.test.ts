import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createStaticHandler, resolvePackageDirectory } from './node.js'

let base: string
let root: string

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'worldkit-static-'))
  root = join(base, 'public')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Home</title>')
  await writeFile(join(root, 'app.js'), 'console.log(1)')
  await writeFile(join(root, 'docs', 'index.html'), '<title>Docs</title>')
  await writeFile(join(base, 'secret.txt'), 'outside')
  await symlink(join(base, 'secret.txt'), join(root, 'leak.txt'))
})

afterAll(() => rm(base, { recursive: true, force: true }))

const get = (path: string, init?: RequestInit) => createStaticHandler({ root })(new Request(`https://example.world${path}`, init))

describe('createStaticHandler', () => {
  it('serves index.html at the root with an HTML content type', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    await expect(response.text()).resolves.toContain('<title>Home</title>')
  })

  it('serves files and directory indexes', async () => {
    expect((await get('/app.js')).headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    await expect((await get('/docs/')).text()).resolves.toContain('Docs')
  })

  it('falls back to index.html for extensionless client routes only', async () => {
    await expect((await get('/places/central-garden')).text()).resolves.toContain('Home')
    expect((await get('/missing.css')).status).toBe(404)
    const strict = createStaticHandler({ root, fallback: false })
    expect((await strict(new Request('https://example.world/places/x'))).status).toBe(404)
  })

  it('never serves files outside the root', async () => {
    expect((await get('/%2e%2e/secret.txt')).status).toBe(404)
    expect((await get('/..%2fsecret.txt')).status).toBe(404)
    expect((await get('/leak.txt')).status).toBe(404)
    expect((await get('/%00')).status).toBe(400)
  })

  it('answers HEAD without a body and rejects other methods', async () => {
    const head = await get('/app.js', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect((await get('/', { method: 'POST' })).status).toBe(405)
  })

  it('answers 404 when the root does not exist', async () => {
    const handler = createStaticHandler({ root: join(base, 'nope') })
    expect((await handler(new Request('https://example.world/'))).status).toBe(404)
  })
})

describe('createStaticHandler prefix', () => {
  it('serves files only under the prefix', async () => {
    const handler = createStaticHandler({ root, prefix: '/vendor/lib/', fallback: false })
    const get = (path: string) => handler(new Request(`https://example.world${path}`))
    expect((await get('/vendor/lib/app.js')).status).toBe(200)
    expect((await get('/app.js')).status).toBe(404)
    expect((await get('/vendor/libx/app.js')).status).toBe(404)
    expect((await get('/vendor/lib/%2e%2e/secret.txt')).status).toBe(404)
  })
})

describe('resolvePackageDirectory', () => {
  it('finds an installed package folder', () => {
    const lib = resolvePackageDirectory('typescript', 'lib', import.meta.url)
    expect(lib.endsWith(join('typescript', 'lib'))).toBe(true)
  })

  it('explains a missing package or folder in plain words', () => {
    expect(() => resolvePackageDirectory('worldkit-not-installed', '', import.meta.url)).toThrow(/npm install worldkit-not-installed/)
    expect(() => resolvePackageDirectory('typescript', 'nope', import.meta.url)).toThrow(/no "nope" folder/)
    expect(() => resolvePackageDirectory('typescript', '../..', import.meta.url)).toThrow(/outside package/)
  })
})
