import { createMemoryRateLimiter, createWorldHandler, type EntitySource } from '@worlddevkit/server'
import {
  WORLD_PROTOCOL_VERSION,
  type EntityEnvelope,
  type WorldDiscoveryDocument,
} from '@worlddevkit/spec'

const worldUrl = normalizeWorldUrl(process.env.WORLD_URL ?? 'http://localhost:8787')

export const discovery: WorldDiscoveryDocument = {
  protocol: WORLD_PROTOCOL_VERSION,
  id: worldUrl,
  name: 'My World',
  description: 'A credential-free, in-memory World Protocol Level 1 world.',
  endpoints: { api: new URL('/api/world/v0', worldUrl).href },
  entityTypes: ['wp:place'],
  actions: ['wp:discover'],
}

const places: EntityEnvelope[] = [
  place('central-garden', 'Central Garden', 'park'),
  place('north-library', 'North Library', 'library'),
  place('riverside-market', 'Riverside Market', 'market'),
]

const source: EntitySource = {
  async list(type) {
    return type === 'wp:place' ? places : []
  },
  async get(type, id) {
    return type === 'wp:place'
      ? places.find((entity) => entity.ref.id === id) ?? null
      : null
  },
}

const worldHandler = createWorldHandler({
  world: discovery,
  source,
  rateLimiter: createMemoryRateLimiter({ limit: 60, windowMs: 60_000 }),
  cors: '*',
  maxPageSize: 50,
})

export async function fetchWorld(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
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

function place(id: string, name: string, category: string): EntityEnvelope {
  return {
    ref: { world: worldUrl, type: 'wp:place', id },
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'public',
    attributes: { name, category },
    relationships: [],
    capabilities: [],
  }
}

function normalizeWorldUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  url.search = ''
  url.hash = ''
  return url.href.replace(/\/$/, '')
}
