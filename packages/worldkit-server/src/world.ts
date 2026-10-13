import {
  WORLD_PROTOCOL_VERSION,
  type EntityEnvelope,
  type EntityRelationship,
  type JsonObject,
  type WorldDiscoveryDocument,
} from '@worlddevkit/spec'

import {
  createMemoryRateLimiter,
  createWorldHandler,
  type EntitySource,
  type RateLimiter,
  type WorldHandlerOptions,
} from './server.js'

export const WELL_KNOWN_WORLD_PATH = '/.well-known/world.json'
const DEFAULT_API_PATH = '/api/world/v0'

/** One entity as authored by a world. `defineWorld` adds `ref.world` and fills defaults. */
export interface WorldEntityInput {
  type: string
  id: string
  attributes: JsonObject
  relationships?: EntityRelationship[]
  capabilities?: string[]
  /** Defaults to 1. Increment it whenever the entity's observable data changes. */
  version?: number
  /** ISO 8601 timestamp. Defaults to the time `defineWorld` was called. */
  updatedAt?: string
  /** Defaults to `public`. Non-public entities are kept out of every Level 1 response. */
  visibility?: EntityEnvelope['visibility']
  location?: JsonObject
  links?: Record<string, string>
  layer?: string
}

export interface DefineWorldOptions {
  /** Public origin of the world, for example `https://lagos.example`. Becomes the discovery `id`. */
  url: string
  name: string
  description?: string
  entities: readonly WorldEntityInput[]
  /**
   * Entity types to advertise. Defaults to every type that appears in `entities`, in first-seen order.
   * Types listed here but absent from `entities` are advertised as empty collections.
   */
  entityTypes?: readonly string[]
  /** Path of the Level 1 API on the world origin. Defaults to `/api/world/v0`. */
  apiPath?: string
  /** Defaults to an in-memory limiter of 60 discovery requests per minute per client. */
  rateLimiter?: RateLimiter
  /** Defaults to `*`: Level 1 reads are public. */
  cors?: WorldHandlerOptions['cors']
  maxPageSize?: number
  /** Attributes `wp:discover` text search matches. See `WorldHandlerOptions.searchFields`. */
  searchFields?: WorldHandlerOptions['searchFields']
  /** Trusted reverse-proxy hops for rate limiting. See `WorldHandlerOptions.trustProxy`. */
  trustProxy?: WorldHandlerOptions['trustProxy']
  /** Rate-limit key override. See `WorldHandlerOptions.clientKey`. */
  clientKey?: WorldHandlerOptions['clientKey']
}

export interface DefinedWorld {
  discovery: WorldDiscoveryDocument
  source: EntitySource
  /** Every entity, including ones that are not public. Useful for tests and server-side rendering. */
  entities: readonly EntityEnvelope[]
  /**
   * Serves `/.well-known/world.json` and the Level 1 API, with the same signature as global
   * `fetch`, so it can be passed straight to `WorldClient` and the conformance suite.
   * Answers 404 for every other path.
   */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  /** True when `url` is a protocol path (discovery or the API) that `fetch` should handle. */
  handles(url: string | URL): boolean
}

/**
 * Define a complete Level 1 world from one list of entities.
 *
 * Discovery, `ref.world`, the advertised entity types and the `list`/`get` source are all derived
 * from the same input, so they cannot drift apart. Duplicate IDs and relationships that point at
 * entities missing from this world throw immediately, before the server starts.
 */
export function defineWorld(options: DefineWorldOptions): DefinedWorld {
  const worldId = normalizeOrigin(options.url)
  const apiPath = normalizeApiPath(options.apiPath ?? DEFAULT_API_PATH)
  const defaultUpdatedAt = new Date().toISOString()

  const entities = options.entities.map((input) => toEnvelope(input, worldId, defaultUpdatedAt))
  const byType = new Map<string, EntityEnvelope[]>()
  const byKey = new Map<string, EntityEnvelope>()
  for (const entity of entities) {
    const key = entityKey(entity.ref.type, entity.ref.id)
    if (byKey.has(key)) throw new Error(`defineWorld: duplicate entity ${entity.ref.type}/${entity.ref.id}`)
    byKey.set(key, entity)
    const collection = byType.get(entity.ref.type) ?? []
    collection.push(entity)
    byType.set(entity.ref.type, collection)
  }

  for (const entity of entities) {
    for (const relationship of entity.relationships) {
      const { target } = relationship
      if (target.world !== undefined && normalizeOriginOrNull(target.world) !== worldId) continue
      if (!byKey.has(entityKey(target.type, target.id))) {
        throw new Error(
          `defineWorld: ${entity.ref.type}/${entity.ref.id} has a "${relationship.rel}" relationship to ` +
          `${target.type}/${target.id}, which is not in this world`,
        )
      }
    }
  }

  const entityTypes = uniqueTypes([...(options.entityTypes ?? []), ...byType.keys()])
  if (entityTypes.length === 0) throw new Error('defineWorld: a world needs at least one entity type')

  const discovery: WorldDiscoveryDocument = {
    protocol: WORLD_PROTOCOL_VERSION,
    id: worldId,
    name: requireText(options.name, 'name'),
    ...(options.description ? { description: options.description } : {}),
    endpoints: { api: `${worldId}${apiPath}` },
    entityTypes,
    actions: ['wp:discover'],
  }

  const source: EntitySource = {
    async list(type) {
      return byType.get(type) ?? []
    },
    async get(type, id) {
      return byKey.get(entityKey(type, id)) ?? null
    },
  }

  const cors = options.cors ?? '*'
  const handler = createWorldHandler({
    world: discovery,
    source,
    rateLimiter: options.rateLimiter ?? createMemoryRateLimiter({ limit: 60, windowMs: 60_000 }),
    cors,
    ...(options.maxPageSize !== undefined ? { maxPageSize: options.maxPageSize } : {}),
    ...(options.searchFields !== undefined ? { searchFields: options.searchFields } : {}),
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
    ...(options.clientKey !== undefined ? { clientKey: options.clientKey } : {}),
  })

  const handles = (url: string | URL): boolean => {
    const { pathname } = new URL(url, worldId)
    return pathname === WELL_KNOWN_WORLD_PATH || pathname === apiPath || pathname.startsWith(`${apiPath}/`)
  }

  return {
    discovery,
    source,
    entities,
    handles,
    async fetch(input, init) {
      const request = input instanceof Request && init === undefined ? input : new Request(input, init)
      const { pathname } = new URL(request.url)
      if (pathname === WELL_KNOWN_WORLD_PATH) return discoveryResponse(request, discovery, cors)
      return handler(request)
    },
  }
}

function discoveryResponse(
  request: Request,
  discovery: WorldDiscoveryDocument,
  cors: WorldHandlerOptions['cors'],
): Response {
  const headers = new Headers({ 'Cache-Control': 'public, max-age=60', Vary: 'Origin' })
  const origin = request.headers.get('origin')
  if (cors === '*') headers.set('Access-Control-Allow-Origin', '*')
  else if (origin && cors?.includes(origin)) headers.set('Access-Control-Allow-Origin', origin)

  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type')
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD, OPTIONS')
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(JSON.stringify({ code: 'method_not_allowed', message: 'Use GET' }), { status: 405, headers })
  }
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(discovery), { status: 200, headers })
}

function toEnvelope(input: WorldEntityInput, world: string, defaultUpdatedAt: string): EntityEnvelope {
  const type = requireText(input.type, 'entity type')
  const id = requireText(input.id, `id of a ${type} entity`)
  const version = input.version ?? 1
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error(`defineWorld: ${type}/${id} version must be a non-negative integer`)
  }
  const updatedAt = input.updatedAt ?? defaultUpdatedAt
  if (Number.isNaN(Date.parse(updatedAt))) throw new Error(`defineWorld: ${type}/${id} updatedAt must be an ISO 8601 date`)

  const envelope: EntityEnvelope = {
    ref: { world, type, id },
    version,
    updatedAt,
    visibility: input.visibility ?? 'public',
    attributes: input.attributes,
    relationships: input.relationships ?? [],
    capabilities: input.capabilities ?? [],
  }
  if (input.location) envelope.location = input.location
  if (input.links) envelope.links = input.links
  if (input.layer) envelope.layer = input.layer
  return envelope
}

function normalizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`defineWorld: url must be an absolute URL, received "${value}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('defineWorld: url must use http or https')
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash) {
    throw new Error(`defineWorld: url must be an origin with no path, query or fragment, received "${value}"`)
  }
  return url.origin
}

function normalizeOriginOrNull(value: string): string | null {
  try {
    return normalizeOrigin(value)
  } catch {
    return null
  }
}

function normalizeApiPath(value: string): string {
  const path = `/${value.replace(/^\/+|\/+$/g, '')}`
  if (path === '/' || path === WELL_KNOWN_WORLD_PATH) throw new Error('defineWorld: apiPath must be a sub-path such as /api/world/v0')
  return path
}

function uniqueTypes(types: readonly string[]): string[] {
  return [...new Set(types.map((type) => requireText(type, 'entity type')))]
}

function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`defineWorld: ${label} must be a non-empty string`)
  return value
}

function entityKey(type: string, id: string): string {
  return `${type}\u0000${id}`
}
