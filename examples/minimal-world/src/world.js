import { createMemoryRateLimiter, createWorldHandler } from '@worlddevkit/server'
import { WORLD_PROTOCOL_VERSION } from '@worlddevkit/spec'

const WORLD_ID = 'https://minimal-world.example'

export const discovery = Object.freeze({
  protocol: WORLD_PROTOCOL_VERSION,
  id: WORLD_ID,
  name: 'Minimal Synthetic World',
  description: 'A credential-free, in-memory World Protocol Level 1 example.',
  endpoints: { api: 'http://localhost:8787/api/world/v0' },
  entityTypes: ['wp:place'],
  actions: ['wp:discover'],
})

const places = Object.freeze([
  place('central-garden', 'Central Garden', 'park'),
  place('north-library', 'North Library', 'library'),
  place('riverside-market', 'Riverside Market', 'market'),
])

function place(id, name, category) {
  return Object.freeze({
    ref: { world: WORLD_ID, type: 'wp:place', id },
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'public',
    attributes: { name, category },
    relationships: [],
    capabilities: [],
  })
}

const source = {
  async list(type) {
    return type === 'wp:place' ? places : []
  },
  async get(type, id) {
    return type === 'wp:place'
      ? places.find((entity) => entity.ref.id === id) ?? null
      : null
  },
}

export const worldHandler = createWorldHandler({
  world: discovery,
  source,
  rateLimiter: createMemoryRateLimiter({ limit: 60, windowMs: 60_000 }),
  cors: '*',
  maxPageSize: 50,
})

export async function fetchWorld(input, init) {
  const request = input instanceof Request ? input : new Request(input, init)
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/.well-known/world.json') {
    return Response.json(discovery, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    })
  }

  return worldHandler(request)
}
