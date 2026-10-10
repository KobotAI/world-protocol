import type {
  DiscoverQuery,
  DiscoverResult,
  EntityEnvelope,
  JsonObject,
  PaginatedEntityCollection,
  ProtocolError,
  WorldDiscoveryDocument,
} from '@worlddevkit/spec'
import { WORLD_PROTOCOL_VERSION } from '@worlddevkit/spec'

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type AccessToken = string | (() => string | undefined | Promise<string | undefined>)

export interface WorldClientOptions {
  fetch?: Fetch
  accessToken?: AccessToken
  headers?: HeadersInit
}

export interface RequestOptions {
  signal?: AbortSignal
}

export interface ListEntitiesOptions extends RequestOptions {
  cursor?: string | null
  limit?: number
}

export class WorldClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

export class WorldNetworkError extends WorldClientError {
  readonly url: string

  constructor(url: string, cause: unknown) {
    super(`World request failed: ${url}`, { cause })
    this.url = url
  }
}

export class WorldResponseError extends WorldClientError {
  readonly url: string

  constructor(url: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.url = url
  }
}

export class WorldHttpError extends WorldClientError {
  readonly status: number
  readonly url: string
  readonly protocolError?: ProtocolError

  constructor(status: number, url: string, protocolError?: ProtocolError) {
    super(protocolError?.message ?? `World request failed with HTTP ${status}`)
    this.status = status
    this.url = url
    this.protocolError = protocolError
  }

  get code(): string | undefined {
    return this.protocolError?.code
  }

  get details(): ProtocolError['details'] | undefined {
    return this.protocolError?.details
  }
}

export async function discoverWorld(world: string | URL, options: WorldClientOptions = {}): Promise<WorldDiscoveryDocument> {
  const url = new URL('/.well-known/world.json', world)
  const fetch = resolveFetch(options.fetch)
  const response = await fetchResponse(fetch, url, {
    headers: mergeHeaders(options.headers, { accept: 'application/json' }),
  })

  return parseResponse<WorldDiscoveryDocument>(response, url, isWorldDiscoveryDocument)
}

export class WorldClient {
  readonly world: WorldDiscoveryDocument
  readonly #fetch: Fetch
  readonly #accessToken?: AccessToken
  readonly #headers?: HeadersInit

  constructor(world: WorldDiscoveryDocument, options: WorldClientOptions = {}) {
    if (!isWorldDiscoveryDocument(world as unknown)) {
      throw new WorldResponseError('<discovery document>', 'Invalid World discovery document')
    }

    this.world = world
    this.#fetch = resolveFetch(options.fetch)
    this.#accessToken = options.accessToken
    this.#headers = options.headers
  }

  static async connect(world: string | URL, options: WorldClientOptions = {}): Promise<WorldClient> {
    return new WorldClient(await discoverWorld(world, options), options)
  }

  async listEntities<Attributes extends JsonObject = JsonObject>(
    type: string,
    options: ListEntitiesOptions = {},
  ): Promise<PaginatedEntityCollection<Attributes>> {
    const url = this.#apiUrl(`entities/${encodeURIComponent(type)}`)
    if (options.cursor != null) url.searchParams.set('cursor', options.cursor)
    if (options.limit != null) url.searchParams.set('limit', String(options.limit))

    return this.#request(url, { method: 'GET', signal: options.signal }, isEntityCollection)
  }

  async getEntity<Attributes extends JsonObject = JsonObject>(
    type: string,
    id: string,
    options: RequestOptions = {},
  ): Promise<EntityEnvelope<Attributes>> {
    const url = this.#apiUrl(`entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
    return this.#request(url, { method: 'GET', signal: options.signal }, isEntityEnvelope)
  }

  async discover<Attributes extends JsonObject = JsonObject>(
    query: DiscoverQuery,
    options: RequestOptions = {},
  ): Promise<DiscoverResult<Attributes>> {
    const url = this.#apiUrl(`actions/${encodeURIComponent('wp:discover')}`)
    const value = await this.#request<unknown>(
      url,
      { method: 'POST', body: JSON.stringify({ input: query }), signal: options.signal },
      () => true,
    )
    const result = isRecord(value) && 'output' in value ? value.output : value
    if (!isEntityCollection(result)) {
      throw new WorldResponseError(url.href, 'World returned an invalid discover result')
    }
    return result as DiscoverResult<Attributes>
  }

  async *paginateEntities<Attributes extends JsonObject = JsonObject>(
    type: string,
    options: ListEntitiesOptions = {},
  ): AsyncGenerator<PaginatedEntityCollection<Attributes>, void, undefined> {
    let cursor = options.cursor ?? null
    const seen = new Set<string>()

    do {
      const page = await this.listEntities<Attributes>(type, { ...options, cursor })
      yield page
      cursor = page.nextCursor
      if (cursor !== null && seen.has(cursor)) {
        throw new WorldResponseError(this.world.endpoints.api, `World repeated pagination cursor: ${cursor}`)
      }
      if (cursor !== null) seen.add(cursor)
    } while (cursor !== null)
  }

  async *entities<Attributes extends JsonObject = JsonObject>(
    type: string,
    options: ListEntitiesOptions = {},
  ): AsyncGenerator<EntityEnvelope<Attributes>, void, undefined> {
    for await (const page of this.paginateEntities<Attributes>(type, options)) {
      yield* page.entities
    }
  }

  #apiUrl(path: string): URL {
    return new URL(`${this.world.endpoints.api.replace(/\/+$/, '')}/${path}`)
  }

  async #request<T>(url: URL, init: RequestInit, validate: (value: unknown) => boolean): Promise<T> {
    const token = await resolveAccessToken(this.#accessToken)
    const headers = mergeHeaders(this.#headers, {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    })
    const response = await fetchResponse(this.#fetch, url, { ...init, headers })
    return parseResponse<T>(response, url, validate)
  }
}

function resolveFetch(fetch?: Fetch): Fetch {
  const implementation = fetch ?? globalThis.fetch
  if (implementation === undefined) throw new WorldClientError('No Fetch implementation is available')
  return implementation.bind(globalThis) as Fetch
}

async function resolveAccessToken(accessToken?: AccessToken): Promise<string | undefined> {
  return typeof accessToken === 'function' ? accessToken() : accessToken
}

function mergeHeaders(base: HeadersInit | undefined, additions: Record<string, string>): Headers {
  const headers = new Headers(base)
  for (const [name, value] of Object.entries(additions)) headers.set(name, value)
  return headers
}

async function fetchResponse(fetch: Fetch, url: URL, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, init)
    if (!response.ok) throw new WorldHttpError(response.status, url.href, await readProtocolError(response))
    return response
  } catch (error) {
    if (error instanceof WorldClientError) throw error
    throw new WorldNetworkError(url.href, error)
  }
}

async function parseResponse<T>(response: Response, url: URL, validate: (value: unknown) => boolean): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    throw new WorldResponseError(url.href, 'World returned invalid JSON', { cause })
  }
  if (!validate(value)) throw new WorldResponseError(url.href, 'World returned an invalid response')
  return value as T
}

async function readProtocolError(response: Response): Promise<ProtocolError | undefined> {
  try {
    const value: unknown = await response.json()
    if (isProtocolError(value)) return value
    if (isRecord(value) && isProtocolError(value.error)) return value.error
  } catch {
    // A non-JSON error still carries useful HTTP status information.
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorldDiscoveryDocument(value: unknown): value is WorldDiscoveryDocument {
  return isRecord(value)
    && value.protocol === WORLD_PROTOCOL_VERSION
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isRecord(value.endpoints)
    && typeof value.endpoints.api === 'string'
    && Array.isArray(value.entityTypes)
    && value.entityTypes.every((type) => typeof type === 'string')
}

function isEntityEnvelope(value: unknown): value is EntityEnvelope {
  return isRecord(value)
    && isRecord(value.ref)
    && typeof value.ref.world === 'string'
    && typeof value.ref.type === 'string'
    && typeof value.ref.id === 'string'
    && Number.isInteger(value.version)
    && typeof value.updatedAt === 'string'
    && isRecord(value.attributes)
    && Array.isArray(value.relationships)
    && Array.isArray(value.capabilities)
}

function isEntityCollection(value: unknown): value is PaginatedEntityCollection {
  return isRecord(value)
    && Array.isArray(value.entities)
    && value.entities.every(isEntityEnvelope)
    && (typeof value.nextCursor === 'string' || value.nextCursor === null)
}

function isProtocolError(value: unknown): value is ProtocolError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string'
}
