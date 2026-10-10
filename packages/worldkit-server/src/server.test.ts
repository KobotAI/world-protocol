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
