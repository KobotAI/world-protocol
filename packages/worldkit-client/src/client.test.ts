import { describe, expect, it, vi } from 'vitest'
import type { EntityEnvelope, WorldDiscoveryDocument } from '@worlddevkit/spec'
import {
  WorldClient,
  WorldHttpError,
  type Fetch,
  WorldNetworkError,
  WorldResponseError,
  discoverWorld,
} from './index.js'

const discovery: WorldDiscoveryDocument = {
  protocol: 'world/0.1',
  id: 'https://example.world',
  name: 'Example World',
  endpoints: { api: 'https://api.example.world/world/v0/' },
  entityTypes: ['wp:store', 'wp:product'],
}

function entity(id: string): EntityEnvelope {
  return {
    ref: { world: discovery.id, type: 'wp:product', id },
    version: 1,
    updatedAt: '2026-10-10T12:00:00Z',
    visibility: 'public',
    attributes: { name: `Product ${id}` },
    relationships: [],
    capabilities: ['wp:view'],
  }
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('world discovery', () => {
  it('loads the well-known document from the world origin', async () => {
    const fetch = vi.fn<Fetch>(async () => json(discovery))
    await expect(discoverWorld('https://example.world/some/path', { fetch })).resolves.toEqual(discovery)

    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://example.world/.well-known/world.json')
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('accept')).toBe('application/json')
  })

  it('connects a ready-to-use client', async () => {
    const fetch = vi.fn<Fetch>(async () => json(discovery))
    const client = await WorldClient.connect('https://example.world', { fetch })
    expect(client.world).toEqual(discovery)
  })

  it('rejects documents for unsupported protocols', async () => {
    const fetch = vi.fn<Fetch>(async () => json({ ...discovery, protocol: 'world/9' }))
    await expect(discoverWorld('https://example.world', { fetch })).rejects.toBeInstanceOf(WorldResponseError)
  })
})

describe('entity reads', () => {
  it('lists entities with encoded query values, auth, and custom headers', async () => {
    const fetch = vi.fn<Fetch>(async () => json({ entities: [entity('one')], nextCursor: null }))
    const client = new WorldClient(discovery, {
      fetch,
      accessToken: async () => 'secret',
      headers: { 'x-client': 'test' },
    })

    await expect(client.listEntities('vendor:type', { cursor: 'next / + ?', limit: 25 })).resolves.toEqual({
      entities: [entity('one')],
      nextCursor: null,
    })

    const [input, init] = fetch.mock.calls[0] ?? []
    const url = new URL(String(input))
    expect(url.pathname).toBe('/world/v0/entities/vendor%3Atype')
    expect(url.searchParams.get('cursor')).toBe('next / + ?')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
    expect(new Headers(init?.headers).get('x-client')).toBe('test')
  })

  it('gets an entity while treating type and ID as opaque path segments', async () => {
    const fetch = vi.fn<Fetch>(async () => json(entity('a/b ?#')))
    const client = new WorldClient(discovery, { fetch })

    await client.getEntity('wp:product', 'a/b ?#')

    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname)
      .toBe('/world/v0/entities/wp%3Aproduct/a%2Fb%20%3F%23')
  })

  it('rejects malformed entity collections', async () => {
    const client = new WorldClient(discovery, { fetch: async () => json({ entities: [], nextCursor: 3 }) })
    await expect(client.listEntities('wp:store')).rejects.toBeInstanceOf(WorldResponseError)
  })
})

describe('discovery queries', () => {
  it('posts the wp:discover action and unwraps action output', async () => {
    const result = { entities: [entity('shoe')], nextCursor: 'page-2' }
    const fetch = vi.fn<Fetch>(async () => json({ output: result }))
    const client = new WorldClient(discovery, { fetch })

    await expect(client.discover({ types: ['wp:product'], text: 'white shoes', limit: 10 })).resolves.toEqual(result)

    const [input, init] = fetch.mock.calls[0] ?? []
    expect(new URL(String(input)).pathname).toBe('/world/v0/actions/wp%3Adiscover')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      input: { types: ['wp:product'], text: 'white shoes', limit: 10 },
    })
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })

  it('also accepts an unwrapped discover result', async () => {
    const result = { entities: [], nextCursor: null }
    const client = new WorldClient(discovery, { fetch: async () => json(result) })
    await expect(client.discover({ layer: 'real' })).resolves.toEqual(result)
  })
})

describe('pagination', () => {
  it('iterates pages and entities using opaque cursors', async () => {
    const fetch = vi.fn<Fetch>()
      .mockResolvedValueOnce(json({ entities: [entity('one')], nextCursor: 'cursor / 2' }))
      .mockResolvedValueOnce(json({ entities: [entity('two')], nextCursor: null }))
    const client = new WorldClient(discovery, { fetch })
    const ids: string[] = []

    for await (const item of client.entities('wp:product', { limit: 1 })) ids.push(item.ref.id)

    expect(ids).toEqual(['one', 'two'])
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('cursor')).toBe('cursor / 2')
  })

  it('stops worlds from trapping callers in a repeated-cursor loop', async () => {
    const fetch = vi.fn<Fetch>(async () => json({ entities: [], nextCursor: 'same' }))
    const client = new WorldClient(discovery, { fetch })

    const consume = async () => {
      for await (const _page of client.paginateEntities('wp:product')) { /* consume */ }
    }

    await expect(consume()).rejects.toThrow('repeated pagination cursor')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('typed errors', () => {
  it('exposes protocol errors from non-success responses', async () => {
    const fetch = async () => json(
      { error: { code: 'not_found', message: 'No such entity', details: { id: 'missing' } } },
      { status: 404 },
    )
    const client = new WorldClient(discovery, { fetch })

    const error = await client.getEntity('wp:product', 'missing').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WorldHttpError)
    expect(error).toMatchObject({ status: 404, code: 'not_found', details: { id: 'missing' } })
  })

  it('preserves HTTP status when an error body is not JSON', async () => {
    const client = new WorldClient(discovery, {
      fetch: async () => new Response('unavailable', { status: 503 }),
    })
    await expect(client.listEntities('wp:store')).rejects.toMatchObject({ status: 503 })
  })

  it('wraps Fetch failures without swallowing their cause', async () => {
    const cause = new TypeError('offline')
    const client = new WorldClient(discovery, { fetch: async () => { throw cause } })
    const error = await client.listEntities('wp:store').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(WorldNetworkError)
    expect(error).toMatchObject({ cause })
  })

  it('types invalid successful JSON as a response error', async () => {
    const client = new WorldClient(discovery, {
      fetch: async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    })
    await expect(client.listEntities('wp:store')).rejects.toThrow('invalid JSON')
  })
})
