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
import {
  ASSET_TYPE,
  ASSETS_EXTENSION,
  PLACEMENT_TYPE,
  PLACEMENTS_EXTENSION,
  createPlacementHost,
  sanitizeAsset,
  type PlacementHost,
  type PlacementPolicy,
} from './assets.js'
import {
  ENTITY_CHANGED_EVENT,
  ENTITY_REMOVED_EVENT,
  LEVEL_2_EXTENSION,
  createActionDispatcher,
  createEventHub,
  createMemorySessions,
  createMemoryStore,
  createSerialQueue,
  type ActionRegistry,
  type SessionStore,
  type WorldStore,
} from './level2.js'

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
  /**
   * Level 2: actions that change the world, by name (for example `game:guess`). Defining any action
   * makes this a Level 2 world: discovery advertises the actions, `wp:session`, the events stream
   * and the `wp:level-2` extension.
   */
  actions?: ActionRegistry
  /** Level 2: world-defined events actions may `emit`, besides `entity.changed` and `entity.removed`. */
  events?: readonly string[]
  /** Level 2: issues and checks session tokens. Defaults to in-memory sessions that last 24 hours. */
  sessions?: SessionStore
  /** Level 2: rate limit for actions, per session. Defaults to 120 actions a minute. */
  actionRateLimiter?: RateLimiter
  /** Level 2: rate limit for new sessions, per client address. Defaults to 10 a minute. */
  sessionRateLimiter?: RateLimiter
  /**
   * The world owner's secret (at least 16 characters, from an environment variable, never in
   * code). Requests with `Authorization: Bearer <adminToken>` may run `requiresAdmin` actions,
   * such as accepting placements.
   */
  adminToken?: string
  /**
   * Host other worlds' assets: adds `wp:offer`, `wp:accept`, `wp:remove` and `wp:placements`,
   * and serves accepted assets as `wp:placement` entities. Needs `adminToken`.
   */
  placements?: PlacementPolicy
}

export interface DefinedWorld {
  discovery: WorldDiscoveryDocument
  source: EntitySource
  /** The entities the world started with, including ones that are not public. */
  entities: readonly EntityEnvelope[]
  /**
   * Read the world's current state, including changes made by actions. To change it from server
   * code (a timer, an import), use `change`.
   */
  read: Pick<WorldStore, 'get' | 'list'>
  /**
   * Change the world from server code, for example when a round timer fires. Runs in the same
   * one-at-a-time queue as actions, so it never interleaves with one.
   */
  change<T>(task: (world: WorldStore) => T | Promise<T>): Promise<T>
  /**
   * Present when the world hosts placements. Call `sync()` to refresh placements from their
   * sources now, or `startSync(ms)` to keep them fresh: it polls every source on that interval
   * and follows sources' live events streams, so changes arrive within a second. It returns a
   * function that stops it.
   */
  placements?: PlacementHost & { startSync(intervalMs?: number): () => void }
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

  const local = isLocalOrigin(worldId)
  for (const entity of entities) {
    if (entity.ref.type !== ASSET_TYPE) continue
    const checked = sanitizeAsset(entity, { allowLocal: local })
    if (!checked.ok) throw new Error(`defineWorld: asset ${entity.ref.id}: ${checked.error}`)
  }
  if (options.placements && !options.adminToken) {
    throw new Error('defineWorld: placements need an adminToken, so only the owner can accept offers. Set one from an environment variable.')
  }

  const entityTypes = uniqueTypes([...(options.entityTypes ?? []), ...byType.keys(), ...(options.placements ? [PLACEMENT_TYPE] : [])])
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

  const actionNames = Object.keys(options.actions ?? {})
  const level2 = actionNames.length > 0 || options.placements !== undefined
  for (const name of actionNames) {
    if (['wp:offer', 'wp:accept', 'wp:remove', 'wp:placements'].includes(name)) {
      throw new Error(`defineWorld: ${name} is provided by placements and cannot be redefined`)
    }
    if (name === 'wp:discover' || name === 'wp:session') throw new Error(`defineWorld: ${name} is built in and cannot be redefined`)
    if (!/^[a-z0-9-]+:[a-z0-9_.-]+$/i.test(name)) throw new Error(`defineWorld: action "${name}" must be namespaced, for example "game:${name}"`)
  }
  const declaredEvents = [...new Set(options.events ?? [])]
  for (const event of declaredEvents) {
    if (event === ENTITY_CHANGED_EVENT || event === ENTITY_REMOVED_EVENT || event === 'reset') {
      throw new Error(`defineWorld: ${event} is a built-in event and does not need declaring`)
    }
  }

  const hub = createEventHub()
  const queue = createSerialQueue()
  const store = createMemoryStore(entities, { world: worldId, hub, events: declaredEvents, types: entityTypes })
  const source: EntitySource = store.source
  const read = { get: store.get, list: store.list }
  const change = <T>(task: (world: WorldStore) => T | Promise<T>): Promise<T> =>
    queue.run(() => {
      const recording = store.recording()
      return task(recording.store)
    })

  const placementHost = options.placements
    ? createPlacementHost(worldId, { allowLocal: local, ...options.placements }, { read, change })
    : undefined

  const dispatcher = level2
    ? createActionDispatcher({
        actions: { ...(options.actions ?? {}), ...(placementHost?.actions ?? {}) },
        store,
        sessions: options.sessions ?? createMemorySessions(),
        queue,
        ...(options.adminToken ? { adminToken: options.adminToken } : {}),
      })
    : undefined

  const extensions: string[] = []
  if (entityTypes.includes(ASSET_TYPE)) extensions.push(ASSETS_EXTENSION)
  if (dispatcher) {
    discovery.actions = ['wp:discover', ...dispatcher.names]
    discovery.endpoints.events = `${worldId}${apiPath}/events`
    discovery.events = [ENTITY_CHANGED_EVENT, ENTITY_REMOVED_EVENT, ...declaredEvents]
    extensions.push(LEVEL_2_EXTENSION)
  }
  if (placementHost) extensions.push(PLACEMENTS_EXTENSION)
  if (extensions.length > 0) discovery.extensions = extensions

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
    ...(dispatcher
      ? {
          actions: dispatcher,
          events: hub,
          actionRateLimiter: options.actionRateLimiter ?? createMemoryRateLimiter({ limit: 120, windowMs: 60_000 }),
          sessionRateLimiter: options.sessionRateLimiter ?? createMemoryRateLimiter({ limit: 10, windowMs: 60_000 }),
        }
      : {}),
  })

  const handles = (url: string | URL): boolean => {
    const { pathname } = new URL(url, worldId)
    return pathname === WELL_KNOWN_WORLD_PATH || pathname === apiPath || pathname.startsWith(`${apiPath}/`)
  }

  return {
    discovery,
    source,
    entities,
    read,
    change,
    ...(placementHost
      ? {
          placements: {
            ...placementHost,
            startSync(intervalMs = 60_000) {
              // Poll every source on a timer, and react at once to sources with live events.
              const timer = setInterval(() => {
                placementHost.sync().catch((error: unknown) => console.error('[WorldKit] Placement sync failed:', error instanceof Error ? error.message : error))
              }, Math.max(5_000, intervalMs))
              ;(timer as { unref?: () => void }).unref?.()
              const stopWatching = placementHost.watchSources(intervalMs)
              return () => {
                clearInterval(timer)
                stopWatching()
              }
            },
          },
        }
      : {}),
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

function isLocalOrigin(origin: string): boolean {
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.test') || host === '::1' || /^127\./.test(host)
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
