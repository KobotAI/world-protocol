import type {
  DiscoverQuery,
  DiscoverResult,
  EntityEnvelope,
  JsonObject,
  PaginatedEntityCollection,
  ProtocolError,
  WorldDiscoveryDocument,
} from '@worlddevkit/spec'

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
}

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
      const isDiscoverAlias = path[0] === 'discover' && path.length === 1 && (request.method === 'GET' || request.method === 'POST')
      const isDiscoverAction = path[0] === 'actions' && path[1] === 'wp:discover' && path.length === 2 && request.method === 'POST'
      if (isDiscoverAlias || isDiscoverAction) {
        const limited = await options.rateLimiter.consume(rateLimitKey(request))
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
    return [attributes.name, attributes.description, attributes.tagline, attributes.category]
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

function rateLimitKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return `discover:${forwarded || request.headers.get('x-real-ip') || 'anonymous'}`
}

function corsHeaders(request: Request, setting: WorldHandlerOptions['cors']): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type',
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
  return json(body, status, headers)
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
