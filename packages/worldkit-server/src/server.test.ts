import { describe, expect, it, vi } from 'vitest'

import type { EntityEnvelope, WorldDiscoveryDocument } from '@worlddevkit/spec'

import { createMemoryRateLimiter, createWorldHandler, type EntitySource } from './server.js'

const world: WorldDiscoveryDocument = {
  protocol: 'world/0.1',
  id: 'https://example.world',
  name: 'Example World',
  endpoints: { api: 'https://example.world/api/world/v0' },
  entityTypes: ['wp:store', 'wp:product'],
}

const stores: EntityEnvelope[] = ['Alpha Shop', 'Beta Market', 'Gamma Goods'].map((name, index) => ({
  ref: { world: world.id, type: 'wp:store', id: String(index + 1) },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  visibility: 'public',
  attributes: { name, category: index === 0 ? 'fashion' : 'general' },
  relationships: [],
  capabilities: ['wp:view'],
}))

const source: EntitySource = {
  async list(type) {
    return type === 'wp:store' ? stores : []
  },
  async get(type, id) {
    return (await this.list(type)).find((entity) => entity.ref.id === id) ?? null
  },
}

function handler(overrides: Partial<Parameters<typeof createWorldHandler>[0]> = {}) {
  return createWorldHandler({
    world,
    source,
    rateLimiter: createMemoryRateLimiter({ limit: 10, windowMs: 60_000 }),
    cors: '*',
    ...overrides,
  })
}

describe('createWorldHandler', () => {
  it('serves its discovery document at the API root', async () => {
    const response = await handler()(new Request('https://example.world/api/world/v0'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ protocol: 'world/0.1', id: world.id })
  })

  it('lists encoded entity types with opaque pagination', async () => {
    const first = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore?limit=2'))
    const page = await first.json() as { entities: EntityEnvelope[]; nextCursor: string }
    expect(page.entities.map((entity) => entity.attributes.name)).toEqual(['Alpha Shop', 'Beta Market'])
    expect(page.nextCursor).not.toContain('2')

    const second = await handler()(new Request(`https://example.world/api/world/v0/entities/wp%3Astore?limit=2&cursor=${page.nextCursor}`))
    await expect(second.json()).resolves.toMatchObject({ entities: [{ attributes: { name: 'Gamma Goods' } }], nextCursor: null })
  })

  it('gets one entity and returns a protocol error when absent', async () => {
    const found = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore/1'))
    expect(found.status).toBe(200)
    const missing = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore/nope'))
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ code: 'entity_not_found', message: 'Entity not found' })
  })

  it('discovers through the canonical action and compatibility alias', async () => {
    const action = await handler()(new Request('https://example.world/api/world/v0/actions/wp%3Adiscover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { types: ['wp:store'], text: 'alpha', category: 'fashion' } }),
    }))
    await expect(action.json()).resolves.toMatchObject({ output: { entities: [{ ref: { id: '1' } }], nextCursor: null } })

    const alias = await handler()(new Request('https://example.world/api/world/v0/discover?type=wp%3Astore&text=alpha&category=fashion'))
    await expect(alias.json()).resolves.toMatchObject({ entities: [{ ref: { id: '1' } }], nextCursor: null })
  })

  it('requires and enforces the discovery rate limiter', async () => {
    const limited = handler({ rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }) })
    expect((await limited(new Request('https://example.world/api/world/v0/discover'))).status).toBe(200)
    const response = await limited(new Request('https://example.world/api/world/v0/discover'))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
  })

  it('answers CORS preflight without touching the source', async () => {
    const list = vi.fn(source.list)
    const response = await handler({ source: { ...source, list } })(new Request('https://example.world/api/world/v0/discover', {
      method: 'OPTIONS',
      headers: { origin: 'https://builder.example' },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(list).not.toHaveBeenCalled()
  })

  it('rejects malformed cursors, limits and action input', async () => {
    const invalidCursor = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore?cursor=bad'))
    expect(invalidCursor.status).toBe(400)
    const invalidLimit = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore?limit=0'))
    expect(invalidLimit.status).toBe(400)
    const invalidAction = await handler()(new Request('https://example.world/api/world/v0/actions/wp%3Adiscover', {
      method: 'POST',
      body: JSON.stringify({ query: {} }),
    }))
    expect(invalidAction.status).toBe(400)
    await expect(invalidAction.json()).resolves.toMatchObject({ code: 'invalid_input' })
  })
})

describe('createWorldHandler visibility', () => {
  const mixed: EntityEnvelope[] = [
    { ...stores[0]!, ref: { ...stores[0]!.ref, id: 'open' } },
    { ...stores[0]!, ref: { ...stores[0]!.ref, id: 'friends' }, visibility: 'connections', attributes: { name: 'Friends Only' } },
    { ...stores[0]!, ref: { ...stores[0]!.ref, id: 'secret' }, visibility: 'private', attributes: { name: 'Secret Stash' } },
  ]
  const mixedSource: EntitySource = {
    async list(type) {
      return type === 'wp:store' ? mixed : []
    },
    async get(type, id) {
      return mixed.find((entity) => entity.ref.type === type && entity.ref.id === id) ?? null
    },
  }

  it('lists only public entities', async () => {
    const response = await handler({ source: mixedSource })(new Request('https://example.world/api/world/v0/entities/wp%3Astore'))
    const body = await response.json() as { entities: EntityEnvelope[] }
    expect(body.entities.map((entity) => entity.ref.id)).toEqual(['open'])
  })

  it('answers 404 for non-public entities', async () => {
    for (const id of ['friends', 'secret']) {
      const response = await handler({ source: mixedSource })(new Request(`https://example.world/api/world/v0/entities/wp%3Astore/${id}`))
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 'entity_not_found' })
    }
  })

  it('never returns non-public entities from discovery', async () => {
    const response = await handler({ source: mixedSource })(new Request('https://example.world/api/world/v0/discover?text=s'))
    const body = await response.json() as { entities: EntityEnvelope[] }
    expect(body.entities.every((entity) => entity.visibility === 'public')).toBe(true)
  })
})

describe('createWorldHandler caching', () => {
  it('lets caches keep successful reads but never errors', async () => {
    const ok = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore'))
    expect(ok.headers.get('cache-control')).toMatch(/^public/)
    const missing = await handler()(new Request('https://example.world/api/world/v0/entities/wp%3Astore/nope'))
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    const limited = handler({ rateLimiter: createMemoryRateLimiter({ limit: 0, windowMs: 60_000 }) })
    const tooMany = await limited(new Request('https://example.world/api/world/v0/discover'))
    expect(tooMany.status).toBe(429)
    expect(tooMany.headers.get('cache-control')).toBe('no-store')
    expect(tooMany.headers.get('retry-after')).not.toBeNull()
  })
})

describe('createWorldHandler rate-limit keys', () => {
  function recordKeys(overrides: Partial<Parameters<typeof createWorldHandler>[0]> = {}) {
    const keys: string[] = []
    const run = handler({ rateLimiter: { consume: (key) => { keys.push(key); return { allowed: true } } }, ...overrides })
    const call = (headers: Record<string, string>) => run(new Request('https://example.world/api/world/v0/discover', { headers }))
    return { keys, call }
  }

  it('uses the address the nearest proxy saw, not one the client wrote', async () => {
    const { keys, call } = recordKeys()
    await call({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })
    await call({ 'x-forwarded-for': '203.0.113.9' })
    expect(keys).toEqual(['discover:203.0.113.9', 'discover:203.0.113.9'])
  })

  it('counts several trusted proxy hops from the right', async () => {
    const { keys, call } = recordKeys({ trustProxy: 2 })
    await call({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4, 10.0.0.2' })
    expect(keys).toEqual(['discover:198.51.100.4'])
  })

  it('ignores forwarding headers when no proxy is trusted', async () => {
    const { keys, call } = recordKeys({ trustProxy: false })
    await call({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' })
    expect(keys).toEqual(['discover:anonymous'])
  })

  it('prefers a clientKey function', async () => {
    const { keys, call } = recordKeys({ clientKey: (request) => request.headers.get('cf-connecting-ip') ?? undefined })
    await call({ 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '6.6.6.6' })
    await call({ 'x-forwarded-for': '6.6.6.6' })
    expect(keys).toEqual(['discover:192.0.2.1', 'discover:6.6.6.6'])
  })
})

describe('createWorldHandler search fields', () => {
  const people: EntityEnvelope[] = [
    { ...stores[0]!, ref: { ...stores[0]!.ref, type: 'wp:person', id: 'ada' }, attributes: { name: 'Ada', bio: 'Loves suya and jollof' } },
  ]
  const peopleSource: EntitySource = {
    async list(type) {
      return type === 'wp:person' ? people : type === 'wp:store' ? stores : []
    },
    async get() {
      return null
    },
  }
  const search = async (text: string, overrides: Partial<Parameters<typeof createWorldHandler>[0]>) => {
    const run = handler({ world: { ...world, entityTypes: ['wp:store', 'wp:person'] }, source: peopleSource, ...overrides })
    const response = await run(new Request(`https://example.world/api/world/v0/discover?text=${encodeURIComponent(text)}`))
    return ((await response.json()) as { entities: EntityEnvelope[] }).entities.map((entity) => entity.ref.id)
  }

  it('searches name, description, tagline and category by default', async () => {
    await expect(search('jollof', {})).resolves.toEqual([])
    await expect(search('fashion', {})).resolves.toEqual(['1'])
  })

  it('searches the configured fields for every type', async () => {
    await expect(search('jollof', { searchFields: ['bio'] })).resolves.toEqual(['ada'])
    await expect(search('fashion', { searchFields: ['bio'] })).resolves.toEqual([])
  })

  it('searches per-type fields and falls back to the defaults', async () => {
    const searchFields = { 'wp:person': ['name', 'bio'] }
    await expect(search('jollof', { searchFields })).resolves.toEqual(['ada'])
    await expect(search('fashion', { searchFields })).resolves.toEqual(['1'])
  })
})
