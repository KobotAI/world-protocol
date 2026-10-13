import type {
  DiscoverQuery,
  DiscoverResult,
  EntityEnvelope,
  JsonObject,
  PaginatedEntityCollection,
  ProtocolError,
  WorldDiscoveryDocument,
} from '@worlddevkit/spec'

import { eventStreamResponse, type ActionDispatcher, type EventHub } from './level2.js'

export interface EntitySource {
  list(type: string): Promise<readonly EntityEnvelope[]>
  get(type: string, id: string): Promise<EntityEnvelope | null>
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult> | RateLimitResult
}

export interface WorldHandlerOptions {
  world: WorldDiscoveryDocument
  source: EntitySource
  rateLimiter: RateLimiter
  cors?: '*' | readonly string[]
  maxPageSize?: number
  /**
   * Attributes that `wp:discover` text search matches. Either one list for every entity type, or
   * a list per type (types without an entry use the default). Defaults to
   * `name`, `description`, `tagline` and `category`.
   */
  searchFields?: readonly string[] | Readonly<Record<string, readonly string[]>>
  /**
   * How many reverse proxies in front of this server append to `X-Forwarded-For`. The rate limiter
   * keys each client by the address the outermost trusted proxy saw, which a client cannot forge.
   * Defaults to 1 (one platform proxy or load balancer). Set `false` when nothing in front of the
   * server sets the header, and pass `clientKey` if your runtime knows the socket address.
   */
  trustProxy?: boolean | number
  /** Derives the rate-limit key for a request. Overrides `trustProxy` when it returns a value. */
  clientKey?: (request: Request) => string | undefined
  /**
   * Level 2: answers `POST {api}/actions/{name}` for every action except `wp:discover`.
   * `defineWorld` builds one from its `actions`; use `createActionDispatcher` to build your own.
   */
  actions?: ActionDispatcher
  /** Level 2: serves `GET {api}/events` as server-sent events from this hub. */
  events?: EventHub
  /** Rate limiter for Level 2 actions, keyed per caller (or per client without a session). Defaults to `rateLimiter`. */
  actionRateLimiter?: RateLimiter
  /**
   * Rate limiter for new sessions (`wp:session`), keyed per client address. Kept separate and
   * tighter than actions, because every session is a fresh player: without it one client can mint
   * players to get around per-player rules. Defaults to `actionRateLimiter`.
   */
  sessionRateLimiter?: RateLimiter
}

export const DEFAULT_SEARCH_FIELDS: readonly string[] = ['name', 'description', 'tagline', 'category']

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

export function createWorldHandler(options: WorldHandlerOptions): (request: Request) => Promise<Response> {
  const apiBase = new URL(options.world.endpoints.api)
  const basePath = apiBase.pathname.replace(/\/$/, '')

  return async (request: Request): Promise<Response> => {
    const cors = corsHeaders(request, options.cors)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      const url = new URL(request.url)
      const path = pathAfterBase(url.pathname, basePath)
      if (path === null) return errorResponse(404, 'not_found', 'Unknown World Protocol route', cors)

      if (request.method === 'GET' && path.length === 0) return json(options.world, 200, cors)
      if (request.method === 'GET' && path[0] === 'entities' && path.length === 2) {
        return await listEntities(path[1] ?? '', url, options, cors)
      }
      if (request.method === 'GET' && path[0] === 'entities' && path.length === 3) {
        const entity = await options.source.get(path[1] ?? '', path[2] ?? '')
        return entity && isPublic(entity) ? json(entity, 200, cors) : errorResponse(404, 'entity_not_found', 'Entity not found', cors)
      }
      if (request.method === 'GET' && path[0] === 'events' && path.length === 1 && options.events) {
        return eventStreamResponse(request, options.events, cors)
      }
      const isDiscoverAlias = path[0] === 'discover' && path.length === 1 && (request.method === 'GET' || request.method === 'POST')
      const isDiscoverAction = path[0] === 'actions' && path[1] === 'wp:discover' && path.length === 2 && request.method === 'POST'
      if (isDiscoverAlias || isDiscoverAction) {
        const limited = await options.rateLimiter.consume(rateLimitKey(request, options))
        if (!limited.allowed) {
          const headers = new Headers(cors)
          headers.set('Retry-After', String(limited.retryAfterSeconds ?? 60))
          return errorResponse(429, 'rate_limited', 'Discovery rate limit exceeded', headers)
        }
        const query = isDiscoverAction
          ? await parseDiscoverActionBody(request)
          : request.method === 'POST'
            ? await parseDiscoverBody(request)
            : discoverQueryFromUrl(url)
        return await discover(query, options, cors, isDiscoverAction)
      }

      if (request.method === 'POST' && path[0] === 'actions' && path.length === 2 && path[1]) {
        if (!options.actions) return errorResponse(404, 'unknown_action', `Unknown action: ${path[1]}`, cors)
        const caller = options.actions.callerFor(request)
        const isSession = path[1] === 'wp:session'
        const limiter = (isSession ? options.sessionRateLimiter : undefined) ?? options.actionRateLimiter ?? options.rateLimiter
        const key = isSession
          ? `session:${rateLimitKey(request, options)}`
          : caller ? `action:${caller.id}` : `action:${rateLimitKey(request, options)}`
        const limited = await limiter.consume(key)
        if (!limited.allowed) {
          const headers = new Headers(cors)
          headers.set('Retry-After', String(limited.retryAfterSeconds ?? 60))
          return errorResponse(429, 'rate_limited', 'Action rate limit exceeded', headers)
        }
        const result = await options.actions.dispatch(path[1], request)
        const response = json(result.body, result.status, cors)
        response.headers.set('Cache-Control', 'no-store')
        return response
      }

      return errorResponse(404, 'not_found', 'Unknown World Protocol route', cors)
    } catch (error) {
      if (error instanceof RequestError) return errorResponse(400, error.code, error.message, cors)
      console.error('[WorldKit] Request failed:', error instanceof Error ? error.message : error)
      return errorResponse(503, 'temporarily_unavailable', 'World temporarily unavailable', cors)
    }
  }
}

async function listEntities(
  type: string,
  url: URL,
  options: WorldHandlerOptions,
  headers: Headers
): Promise<Response> {
  if (!options.world.entityTypes.includes(type)) return errorResponse(404, 'unknown_entity_type', `Unknown entity type: ${type}`, headers)
  const all = (await options.source.list(type)).filter(isPublic)
  const page = paginate(all, url.searchParams.get('cursor'), pageSize(url.searchParams.get('limit'), options.maxPageSize))
  return json(page, 200, headers)
}

async function discover(
  query: DiscoverQuery,
  options: WorldHandlerOptions,
  headers: Headers,
  wrapAsActionOutput = false,
): Promise<Response> {
  const types = query.types?.length ? query.types : options.world.entityTypes
  const knownTypes = types.filter((type) => options.world.entityTypes.includes(type))
  const collections = await Promise.all(knownTypes.map((type) => options.source.list(type)))
  const text = query.text?.trim().toLocaleLowerCase()
  const category = query.category?.trim().toLocaleLowerCase()
  const matches = collections.flat().filter(isPublic).filter((entity) => {
    const attributes = entity.attributes as JsonObject
    if (query.layer && entity.layer !== query.layer) return false
    if (category && String(attributes.category ?? '').toLocaleLowerCase() !== category) return false
    if (!text) return true
    return searchFieldsFor(entity.ref.type, options.searchFields)
      .map((field) => attributes[field])
      .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(text))
  })
  const result: DiscoverResult = paginate(matches, query.cursor ?? null, clampLimit(query.limit, options.maxPageSize))
  return json(wrapAsActionOutput ? { output: result } : result, 200, headers)
}

/**
 * Level 1 is an anonymous, public-read surface. Entities a source returns with `connections`
 * or `private` visibility are never served: lists and discovery skip them and `get` answers 404,
 * exactly as if the entity did not exist.
 */
function isPublic(entity: EntityEnvelope): boolean {
  return entity.visibility === 'public'
}

function paginate<T extends EntityEnvelope>(entities: readonly T[], cursor: string | null, limit: number): PaginatedEntityCollection {
  const offset = decodeCursor(cursor)
  const page = entities.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return { entities: page, nextCursor: nextOffset < entities.length ? encodeCursor(nextOffset) : null }
}

function pageSize(raw: string | null, configuredMax?: number): number {
  if (raw === null) return Math.min(DEFAULT_PAGE_SIZE, configuredMax ?? MAX_PAGE_SIZE)
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RequestError('invalid_limit', 'limit must be a positive integer')
  return clampLimit(parsed, configuredMax)
}

function clampLimit(value?: number, configuredMax?: number): number {
  const max = Math.max(1, Math.min(configuredMax ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE))
  if (value === undefined) return Math.min(DEFAULT_PAGE_SIZE, max)
  if (!Number.isSafeInteger(value) || value < 1) throw new RequestError('invalid_limit', 'limit must be a positive integer')
  return Math.min(value, max)
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0
  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(normalized)) as { offset?: unknown }
    if (!Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0) throw new Error('invalid offset')
    return Number(decoded.offset)
  } catch {
    throw new RequestError('invalid_cursor', 'cursor is invalid')
  }
}

function discoverQueryFromUrl(url: URL): DiscoverQuery {
  const types = url.searchParams.getAll('type').filter(Boolean)
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
  return {
    ...(types.length ? { types } : {}),
    ...(url.searchParams.get('text') ? { text: url.searchParams.get('text') ?? undefined } : {}),
    ...(url.searchParams.get('category') ? { category: url.searchParams.get('category') ?? undefined } : {}),
    ...(url.searchParams.get('layer') ? { layer: url.searchParams.get('layer') ?? undefined } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') } : {}),
  }
}

async function parseDiscoverBody(request: Request): Promise<DiscoverQuery> {
  const value = await parseJsonObject(request)
  return value as DiscoverQuery
}

async function parseDiscoverActionBody(request: Request): Promise<DiscoverQuery> {
  const value = await parseJsonObject(request)
  if (!value.input || typeof value.input !== 'object' || Array.isArray(value.input)) {
    throw new RequestError('invalid_input', 'Discovery action input must be a JSON object')
  }
  return value.input as DiscoverQuery
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object')
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError('invalid_json', 'Request body must be a JSON object')
  }
}

function pathAfterBase(pathname: string, basePath: string): string[] | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null
  const suffix = pathname.slice(basePath.length).replace(/^\//, '')
  if (!suffix) return []
  try {
    return suffix.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    throw new RequestError('invalid_path', 'Path contains invalid encoding')
  }
}

function searchFieldsFor(type: string, setting: WorldHandlerOptions['searchFields']): readonly string[] {
  if (setting === undefined) return DEFAULT_SEARCH_FIELDS
  if (isFieldList(setting)) return setting
  return setting[type] ?? DEFAULT_SEARCH_FIELDS
}

function isFieldList(value: NonNullable<WorldHandlerOptions['searchFields']>): value is readonly string[] {
  return Array.isArray(value)
}

/**
 * Rate-limit key for a request. `X-Forwarded-For` is a list each proxy appends to, so only the
 * entries added by trusted proxies are reliable: the client controls everything to their left.
 * With N trusted proxies the client's real address is the Nth entry from the right.
 */
function rateLimitKey(request: Request, options: WorldHandlerOptions): string {
  const custom = options.clientKey?.(request)
  if (custom) return `discover:${custom}`

  const trusted = options.trustProxy === undefined || options.trustProxy === true
    ? 1
    : options.trustProxy === false ? 0 : Math.max(0, Math.floor(options.trustProxy))
  if (trusted > 0) {
    const hops = (request.headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const client = hops.length >= trusted ? hops[hops.length - trusted] : hops[0]
    if (client) return `discover:${client}`
    const realIp = request.headers.get('x-real-ip')?.trim()
    if (realIp) return `discover:${realIp}`
  }
  return 'discover:anonymous'
}

function corsHeaders(request: Request, setting: WorldHandlerOptions['cors']): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Last-Event-ID',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  })
  const origin = request.headers.get('origin')
  if (setting === '*') headers.set('Access-Control-Allow-Origin', '*')
  else if (origin && setting?.includes(origin)) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}

function json(value: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
  responseHeaders.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return new Response(JSON.stringify(value), { status, headers: responseHeaders })
}

function errorResponse(status: number, code: string, message: string, headers: Headers): Response {
  const body: ProtocolError = { code, message }
  const response = json(body, status, headers)
  // Errors, including 429s, describe this moment only. Shared caches must not keep serving them.
  response.headers.set('Cache-Control', 'no-store')
  return response
}

class RequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export interface MemoryRateLimiterOptions {
  limit: number
  windowMs: number
}

/** Suitable for one-process deployments and tests. Use a shared adapter when horizontally scaling. */
export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { count: number; resetsAt: number }>()
  return {
    consume(key) {
      const now = Date.now()
      const current = buckets.get(key)
      const bucket = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + options.windowMs } : current
      bucket.count += 1
      buckets.set(key, bucket)
      return {
        allowed: bucket.count <= options.limit,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)),
      }
    },
  }
}
