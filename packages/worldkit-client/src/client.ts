import type {
  DiscoverQuery,
  DiscoverResult,
  EntityEnvelope,
  EntityRef,
  JsonObject,
  JsonValue,
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

export interface InvokeOptions extends RequestOptions {
  /** The entity the action acts on. Its `capabilities` must include the action. */
  target?: { type: string; id: string }
  /** Refuse with `version_conflict` (HTTP 409) unless the target is still at this version. */
  ifVersion?: number
}

export interface ActionResult<Output extends JsonValue = JsonValue> {
  output: Output
  /** Public entities the action created or changed, at their new versions. */
  changed: EntityEnvelope[]
  /** Refs of public entities the action removed. */
  removed: EntityRef[]
}

export interface Session {
  token: string
  caller: string
  expiresAt: string
}

export interface WorldStreamEvent {
  /** Monotonic event id. Pass the last one you saw as `lastEventId` to resume. */
  id: number
  /** `entity.changed`, `entity.removed`, `reset`, or a world-defined event such as `game:round`. */
  event: string
  data: JsonValue
}

export interface SubscribeOptions {
  /** Resume after this event id. */
  lastEventId?: number
  signal?: AbortSignal
  /** Reconnect after a dropped connection. Defaults to true. */
  reconnect?: boolean
  /** Called when the connection drops (before reconnecting) or fails for good. */
  onError?: (error: unknown) => void
}

export interface Subscription {
  close(): void
  /** Resolves when the subscription ends: closed, aborted, or failed without reconnecting. */
  readonly closed: Promise<void>
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

  /** True when the world advertises Level 2: actions that change it, sessions and live events. */
  get isLevel2(): boolean {
    return this.world.extensions?.includes('wp:level-2') === true
  }

  /**
   * Starts a session with a Level 2 world. Pass the returned token as `accessToken` (or use
   * `withAccessToken`) so the world knows which caller made each action.
   */
  async startSession(options: RequestOptions = {}): Promise<Session> {
    const result = await this.invoke<JsonObject>('wp:session', {}, options)
    const output = result.output
    if (typeof output.token !== 'string' || typeof output.caller !== 'string' || typeof output.expiresAt !== 'string') {
      throw new WorldResponseError(this.#apiUrl('actions/wp%3Asession').href, 'World returned an invalid session')
    }
    return { token: output.token, caller: output.caller, expiresAt: output.expiresAt }
  }

  /** A client for the same world that sends `token` with every request. */
  withAccessToken(token: string): WorldClient {
    return new WorldClient(this.world, { fetch: this.#fetch, accessToken: token, ...(this.#headers ? { headers: this.#headers } : {}) })
  }

  /**
   * Invokes a Level 2 action. Refusals throw `WorldHttpError`: check `error.code`, for example
   * `version_conflict` (with the current entity in `error.details.current`), `not_allowed`, or
   * a world-defined code.
   */
  async invoke<Output extends JsonValue = JsonValue>(
    action: string,
    input: JsonObject = {},
    options: InvokeOptions = {},
  ): Promise<ActionResult<Output>> {
    const url = this.#apiUrl(`actions/${encodeURIComponent(action)}`)
    const body: JsonObject = { input }
    if (options.target) body.target = { type: options.target.type, id: options.target.id }
    if (options.ifVersion !== undefined) body.ifVersion = options.ifVersion
    const value = await this.#request<unknown>(url, { method: 'POST', body: JSON.stringify(body), signal: options.signal }, isActionResult)
    return value as ActionResult<Output>
  }

  /**
   * Streams a Level 2 world's events: entity changes and world-defined events. Reconnects after
   * a dropped connection and resumes where it left off. A `reset` event means the world could not
   * replay what you missed: refetch the state you show.
   */
  subscribe(onEvent: (event: WorldStreamEvent) => void, options: SubscribeOptions = {}): Subscription {
    const endpoint = this.world.endpoints.events
    if (!endpoint) throw new WorldClientError('This world does not advertise an events endpoint')
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort)
    let lastEventId = options.lastEventId

    const loop = async () => {
      let delay = 500
      while (!controller.signal.aborted) {
        try {
          const token = await resolveAccessToken(this.#accessToken)
          const headers = mergeHeaders(this.#headers, {
            accept: 'text/event-stream',
            ...(lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }),
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          })
          const response = await fetchResponse(this.#fetch, new URL(endpoint), { headers, signal: controller.signal })
          if (!response.body) throw new WorldResponseError(endpoint, 'World returned an empty event stream')
          delay = 500
          for await (const event of readServerSentEvents(response.body, controller.signal)) {
            lastEventId = event.id
            onEvent(event)
          }
          throw new WorldResponseError(endpoint, 'World closed the event stream')
        } catch (error) {
          if (controller.signal.aborted) return
          options.onError?.(error)
          if (options.reconnect === false || (error instanceof WorldHttpError && error.status < 500 && error.status !== 429)) return
          await sleep(delay, controller.signal)
          delay = Math.min(delay * 2, 10_000)
        }
      }
    }

    const closed = loop().finally(() => options.signal?.removeEventListener('abort', abort))
    return { close: abort, closed }
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

function isActionResult(value: unknown): value is ActionResult {
  return isRecord(value)
    && 'output' in value
    && Array.isArray(value.changed)
    && value.changed.every(isEntityEnvelope)
    && Array.isArray(value.removed)
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<WorldStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // Not every runtime cancels a response body when its request is aborted; cancel it here.
  const cancel = () => {
    reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        let id: number | undefined
        let event = 'message'
        const data: string[] = []
        for (const line of block.split('\n')) {
          if (line === '' || line.startsWith(':')) continue
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const text = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'id') id = Number.parseInt(text, 10)
          else if (field === 'event') event = text
          else if (field === 'data') data.push(text)
        }
        if (data.length === 0 || id === undefined || !Number.isSafeInteger(id)) continue
        let parsed: JsonValue
        try {
          parsed = JSON.parse(data.join('\n')) as JsonValue
        } catch {
          continue
        }
        yield { id, event, data: parsed }
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

function isProtocolError(value: unknown): value is ProtocolError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string'
}
