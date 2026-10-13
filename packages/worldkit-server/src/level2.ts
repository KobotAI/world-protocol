/**
 * Level 2: worlds that change.
 *
 * Level 1 is read-only. Level 2 adds three things on top of it:
 * - actions that change entities (`POST {api}/actions/{name}`), with optimistic concurrency on
 *   each entity's `version`;
 * - sessions, so actions know which caller made them (`wp:session` issues a bearer token);
 * - a live stream of changes (`GET {api}/events`, server-sent events).
 *
 * Everything here is runtime-neutral: Web Crypto, `ReadableStream` and `TextEncoder` only.
 */
import type {
  EntityEnvelope,
  EntityRef,
  EntityRelationship,
  JsonObject,
  JsonValue,
} from '@worlddevkit/spec'

export const LEVEL_2_EXTENSION = 'wp:level-2'
export const SESSION_ACTION = 'wp:session'
export const ENTITY_CHANGED_EVENT = 'entity.changed'
export const ENTITY_REMOVED_EVENT = 'entity.removed'

/** An error an action handler throws to refuse a request with a protocol error. */
export class ActionError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: JsonValue

  /**
   * @param code     machine-readable reason, for example `round_closed`
   * @param message  human-readable reason, safe to show to players
   * @param status   HTTP status; 422 (the request was valid but the world refused it) by default
   */
  constructor(code: string, message: string, status = 422, details?: JsonValue) {
    super(message)
    this.name = 'ActionError'
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }
}

export interface Caller {
  /** Opaque, stable for the life of the session. `admin` for the world's owner. */
  id: string
  /** True when the request carried the world's admin token. */
  admin?: boolean
}

/** Changes to apply to an entity. Attributes are merged shallowly; other fields are replaced. */
export interface EntityChanges {
  attributes?: JsonObject
  relationships?: EntityRelationship[]
  capabilities?: string[]
  visibility?: EntityEnvelope['visibility']
  location?: JsonObject
  links?: Record<string, string>
  sponsorship?: JsonObject
}

export interface NewEntity {
  type: string
  id: string
  attributes: JsonObject
  relationships?: EntityRelationship[]
  capabilities?: string[]
  visibility?: EntityEnvelope['visibility']
  location?: JsonObject
  links?: Record<string, string>
  layer?: string
  sponsorship?: JsonObject
}

export interface UpdateOptions {
  /** Refuse with 409 `version_conflict` unless the entity is still at this version. */
  ifVersion?: number
}

/** Read and write access to a world's entities from inside an action. */
export interface WorldStore {
  get(type: string, id: string): EntityEnvelope | null
  list(type: string): readonly EntityEnvelope[]
  /** Adds an entity at version 1. Throws if it already exists or a relationship target is missing. */
  create(entity: NewEntity): EntityEnvelope
  /** Applies changes, increments `version`, sets `updatedAt`, and publishes `entity.changed`. */
  update(type: string, id: string, changes: EntityChanges | ((current: EntityEnvelope) => EntityChanges), options?: UpdateOptions): EntityEnvelope
  /** Removes an entity and publishes `entity.removed`. Returns false if it did not exist. */
  remove(type: string, id: string): boolean
  /** Publishes a world-defined event, for example `game:round_started`. Must be declared in `events`. */
  emit(event: string, data: JsonValue): void
}

export interface ActionContext {
  /** The request's `input`, always a JSON object. Validate it before use. */
  input: JsonObject
  /** The entity the action targets, if the request named one. Its capabilities already allow this action. */
  target: EntityEnvelope | null
  /** The `ifVersion` the caller sent, already checked against `target` before the handler runs. */
  ifVersion: number | null
  /** The session's caller, or null for anonymous requests to actions that allow them. */
  caller: Caller | null
  world: WorldStore
  request: Request
  /** What `prepare` returned, or null when the action has no `prepare`. */
  prepared: JsonValue
}

export interface ActionDefinition {
  /**
   * Runs the action. Return the output to send back (any JSON value, or nothing). Throw
   * `ActionError` to refuse. Actions in one world run one at a time, so reading state and then
   * updating it is atomic even across `await`.
   */
  handler(context: ActionContext): JsonValue | void | Promise<JsonValue | void>
  /** Require a session token. Defaults to true. */
  requiresCaller?: boolean
  /** Require the world's admin token (the owner). Implies a caller. */
  requiresAdmin?: boolean
  /** Require a `target` entity of one of these types. When set, requests without a target get 400. */
  targetTypes?: readonly string[]
  /**
   * Slow work that does not touch world state, such as fetching from another world. It runs
   * before the action joins the one-at-a-time queue, so it never delays other actions. Its
   * result reaches the handler as `prepared`. Throw `ActionError` to refuse.
   */
  prepare?(context: { input: JsonObject; caller: Caller | null; request: Request }): Promise<JsonValue> | JsonValue
}

export type ActionRegistry = Readonly<Record<string, ActionDefinition>>

export interface ActionResult {
  output: JsonValue | null
  /** Public entities this action created or changed, at their new versions. */
  changed: EntityEnvelope[]
  /** Refs of public entities this action removed. */
  removed: EntityRef[]
}

// ---------------------------------------------------------------------------------------------
// Event hub

export interface WorldEvent {
  id: number
  event: string
  data: JsonValue
}

export interface EventHub {
  publish(event: string, data: JsonValue): WorldEvent
  subscribe(listener: (event: WorldEvent) => void): () => void
  /** Events after `lastId`, or null when `lastId` is older than the retained history. */
  since(lastId: number): WorldEvent[] | null
  readonly lastId: number
}

export function createEventHub(options: { history?: number } = {}): EventHub {
  const history = Math.max(0, options.history ?? 500)
  const buffer: WorldEvent[] = []
  const listeners = new Set<(event: WorldEvent) => void>()
  let lastId = 0

  return {
    get lastId() {
      return lastId
    },
    publish(event, data) {
      const entry: WorldEvent = { id: ++lastId, event, data }
      buffer.push(entry)
      if (buffer.length > history) buffer.shift()
      for (const listener of [...listeners]) {
        try {
          listener(entry)
        } catch (error) {
          console.error('[WorldKit] Event listener failed:', error instanceof Error ? error.message : error)
        }
      }
      return entry
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    since(id) {
      if (id >= lastId) return []
      const oldest = buffer[0]?.id ?? lastId + 1
      if (id < oldest - 1) return null
      return buffer.filter((entry) => entry.id > id)
    },
  }
}

const encoder = new TextEncoder()

/**
 * Server-sent events response for a hub. Resumes from `Last-Event-ID` when the history still
 * covers it, otherwise sends a `reset` event so the client refetches state.
 */
export function eventStreamResponse(request: Request, hub: EventHub, headers: Headers, heartbeatMs = 15_000): Response {
  const lastEventId = Number.parseInt(request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('lastEventId') ?? '', 10)
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          cleanup()
        }
      }
      const write = (entry: WorldEvent) => send(formatEvent(entry))

      send(`retry: 2000\n: connected\n\n`)
      if (Number.isSafeInteger(lastEventId)) {
        const missed = hub.since(lastEventId)
        if (missed === null) send(formatEvent({ id: hub.lastId, event: 'reset', data: { reason: 'history_expired' } }))
        else missed.forEach(write)
      }

      const unsubscribe = hub.subscribe(write)
      const heartbeat = setInterval(() => send(`: heartbeat\n\n`), heartbeatMs)
      const onAbort = () => cleanup()
      cleanup = () => {
        unsubscribe()
        clearInterval(heartbeat)
        request.signal.removeEventListener('abort', onAbort)
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
        cleanup = () => {}
      }
      if (request.signal.aborted) cleanup()
      else request.signal.addEventListener('abort', onAbort)
    },
    cancel() {
      cleanup()
    },
  })

  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8')
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('X-Accel-Buffering', 'no')
  return new Response(stream, { status: 200, headers: responseHeaders })
}

function formatEvent(entry: WorldEvent): string {
  return `id: ${entry.id}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`
}

// ---------------------------------------------------------------------------------------------
// Sessions

export interface SessionStore {
  issue(): { token: string; caller: Caller; expiresAt: string }
  resolve(token: string): Caller | null
}

export function createMemorySessions(options: { ttlMs?: number; maxSessions?: number } = {}): SessionStore {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
  const maxSessions = options.maxSessions ?? 10_000
  const sessions = new Map<string, { caller: Caller; expiresAt: number }>()

  return {
    issue() {
      const now = Date.now()
      if (sessions.size >= maxSessions) {
        for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token)
        if (sessions.size >= maxSessions) {
          const oldest = sessions.keys().next().value
          if (oldest !== undefined) sessions.delete(oldest)
        }
      }
      const token = randomToken(32)
      const caller = { id: `c_${randomToken(12)}` }
      const expiresAt = now + ttlMs
      sessions.set(token, { caller, expiresAt })
      return { token, caller, expiresAt: new Date(expiresAt).toISOString() }
    },
    resolve(token) {
      const session = sessions.get(token)
      if (!session) return null
      if (session.expiresAt <= Date.now()) {
        sessions.delete(token)
        return null
      }
      return session.caller
    },
  }
}

function randomToken(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  let binary = ''
  for (const value of values) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------------------------
// Memory store

export interface MemoryStoreOptions {
  world: string
  hub: EventHub
  /** Events the world may `emit`, besides `entity.changed` and `entity.removed`. */
  events?: readonly string[]
  /** Entity types the world advertises. `create` refuses any other type. Defaults to any type. */
  types?: readonly string[]
  now?: () => Date
}

export interface MemoryStore extends WorldStore {
  /** Entity source for the Level 1 handler: async reads of the same data. */
  source: {
    list(type: string): Promise<readonly EntityEnvelope[]>
    get(type: string, id: string): Promise<EntityEnvelope | null>
  }
  /** A store that records what it changes, for one action. Call `finish` when the action is done. */
  recording(): { store: WorldStore; finish(): { changed: EntityEnvelope[]; removed: EntityRef[] } }
  types(): string[]
}

export function createMemoryStore(initial: readonly EntityEnvelope[], options: MemoryStoreOptions): MemoryStore {
  const byType = new Map<string, Map<string, EntityEnvelope>>()
  const allowedEvents = new Set(options.events ?? [])
  const now = options.now ?? (() => new Date())
  for (const entity of initial) collection(entity.ref.type).set(entity.ref.id, freeze(entity))

  function collection(type: string): Map<string, EntityEnvelope> {
    let entries = byType.get(type)
    if (!entries) {
      entries = new Map()
      byType.set(type, entries)
    }
    return entries
  }

  function requireTargets(relationships: readonly EntityRelationship[], from: string): void {
    for (const { rel, target } of relationships) {
      if (target.world !== undefined && target.world !== options.world) continue
      if (!byType.get(target.type)?.has(target.id)) {
        throw new ActionError('invalid_relationship', `${from} has a "${rel}" relationship to ${target.type}/${target.id}, which is not in this world`)
      }
    }
  }

  function publishChange(entity: EntityEnvelope, recorder?: Recorder): void {
    if (entity.visibility !== 'public') return
    options.hub.publish(ENTITY_CHANGED_EVENT, { entity: entity as unknown as JsonObject })
    recorder?.changed.set(key(entity.ref.type, entity.ref.id), entity)
  }

  interface Recorder {
    changed: Map<string, EntityEnvelope>
    removed: EntityRef[]
  }

  function makeStore(recorder?: Recorder): WorldStore {
    return {
      get(type, id) {
        return byType.get(type)?.get(id) ?? null
      },
      list(type) {
        return [...(byType.get(type)?.values() ?? [])]
      },
      create(input) {
        if (options.types && !options.types.includes(input.type)) {
          throw new Error(`Entity type "${input.type}" is not advertised by this world. Add it to entityTypes in defineWorld.`)
        }
        const entries = collection(input.type)
        if (entries.has(input.id)) throw new ActionError('entity_exists', `${input.type}/${input.id} already exists`, 409)
        const relationships = input.relationships ?? []
        requireTargets(relationships, `${input.type}/${input.id}`)
        const entity: EntityEnvelope = {
          ref: { world: options.world, type: input.type, id: input.id },
          version: 1,
          updatedAt: now().toISOString(),
          visibility: input.visibility ?? 'public',
          attributes: input.attributes,
          relationships,
          capabilities: input.capabilities ?? [],
        }
        if (input.location) entity.location = input.location
        if (input.links) entity.links = input.links
        if (input.layer) entity.layer = input.layer
        if (input.sponsorship) entity.sponsorship = input.sponsorship
        const frozen = freeze(entity)
        entries.set(input.id, frozen)
        publishChange(frozen, recorder)
        return frozen
      },
      update(type, id, changes, updateOptions = {}) {
        const current = byType.get(type)?.get(id)
        if (!current) throw new ActionError('entity_not_found', `${type}/${id} does not exist`, 404)
        if (updateOptions.ifVersion !== undefined && current.version !== updateOptions.ifVersion) {
          throw versionConflict(current)
        }
        const patch = typeof changes === 'function' ? changes(current) : changes
        if (patch.relationships) requireTargets(patch.relationships, `${type}/${id}`)
        const next: EntityEnvelope = {
          ...current,
          version: current.version + 1,
          updatedAt: now().toISOString(),
          attributes: patch.attributes ? { ...current.attributes, ...patch.attributes } : current.attributes,
          relationships: patch.relationships ?? current.relationships,
          capabilities: patch.capabilities ?? current.capabilities,
          visibility: patch.visibility ?? current.visibility,
        }
        if (patch.location) next.location = patch.location
        if (patch.links) next.links = patch.links
        if (patch.sponsorship) next.sponsorship = patch.sponsorship
        const frozen = freeze(next)
        collection(type).set(id, frozen)
        if (current.visibility === 'public' && frozen.visibility !== 'public') {
          options.hub.publish(ENTITY_REMOVED_EVENT, { ref: frozen.ref as unknown as JsonObject })
          recorder?.removed.push(frozen.ref)
        } else {
          publishChange(frozen, recorder)
        }
        return frozen
      },
      remove(type, id) {
        const current = byType.get(type)?.get(id)
        if (!current) return false
        byType.get(type)?.delete(id)
        if (current.visibility === 'public') {
          options.hub.publish(ENTITY_REMOVED_EVENT, { ref: current.ref as unknown as JsonObject })
          recorder?.removed.push(current.ref)
          recorder?.changed.delete(key(type, id))
        }
        return true
      },
      emit(event, data) {
        if (!allowedEvents.has(event)) {
          throw new Error(`World event "${event}" is not declared. Add it to the world's events list.`)
        }
        options.hub.publish(event, data)
      },
    }
  }

  const plain = makeStore()
  return {
    ...plain,
    source: {
      async list(type) {
        return plain.list(type)
      },
      async get(type, id) {
        return plain.get(type, id)
      },
    },
    recording() {
      const recorder: Recorder = { changed: new Map(), removed: [] }
      return {
        store: makeStore(recorder),
        finish: () => ({ changed: [...recorder.changed.values()], removed: [...recorder.removed] }),
      }
    },
    types() {
      return [...byType.keys()]
    },
  }
}

export function versionConflict(current: EntityEnvelope): ActionError {
  const details = current.visibility === 'public' ? { current: current as unknown as JsonObject } : undefined
  return new ActionError(
    'version_conflict',
    `${current.ref.type}/${current.ref.id} changed: it is now at version ${current.version}`,
    409,
    details,
  )
}

function freeze<T extends object>(value: T): T {
  return Object.freeze(value)
}

function key(type: string, id: string): string {
  return `${type}\u0000${id}`
}

// ---------------------------------------------------------------------------------------------
// Action dispatcher

/** Runs tasks one at a time, in order. Shared by actions and server-side world changes. */
export interface SerialQueue {
  run<T>(task: () => T | Promise<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run(task) {
      const result = tail.then(task)
      tail = result.catch(() => undefined)
      return result
    },
  }
}

export interface ActionDispatcherOptions {
  actions: ActionRegistry
  store: MemoryStore
  sessions?: SessionStore
  /** Share one queue with server-side changes (timers, imports) so they never interleave with actions. */
  queue?: SerialQueue
  /**
   * The world owner's secret. A request with `Authorization: Bearer <adminToken>` acts as the
   * caller `{ id: 'admin', admin: true }`, which `requiresAdmin` actions need.
   */
  adminToken?: string
}

export interface DispatchResult {
  status: number
  body: JsonValue
}

export interface ActionDispatcher {
  /** Names of every action this dispatcher answers, including `wp:session` when sessions are on. */
  readonly names: readonly string[]
  dispatch(name: string, request: Request): Promise<DispatchResult>
  /** The caller for a request's bearer token, if any. */
  callerFor(request: Request): Caller | null
}

export function createActionDispatcher(options: ActionDispatcherOptions): ActionDispatcher {
  const names = [...(options.sessions ? [SESSION_ACTION] : []), ...Object.keys(options.actions)]
  const queue = options.queue ?? createSerialQueue()

  const adminToken = options.adminToken && options.adminToken.length >= 16 ? options.adminToken : undefined
  if (options.adminToken && !adminToken) throw new Error('adminToken must be at least 16 characters')

  const callerFor = (request: Request): Caller | null => {
    const header = request.headers.get('authorization') ?? ''
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
    const token = match?.[1]
    if (!token) return null
    if (adminToken && constantTimeEqual(token, adminToken)) return { id: 'admin', admin: true }
    return options.sessions ? options.sessions.resolve(token) : null
  }

  type Preflight =
    | { done: DispatchResult }
    | { definition: ActionDefinition; body: Exclude<ParsedBody, { error: DispatchResult }>; caller: Caller | null; prepared: JsonValue | undefined }

  // Everything that does not read or change world state runs outside the queue, so a slow
  // `prepare` (a network call) never holds up other players' actions.
  const preflight = async (name: string, request: Request): Promise<Preflight> => {
    if (name === SESSION_ACTION && options.sessions) {
      const session = options.sessions.issue()
      return { done: ok({ token: session.token, caller: session.caller.id, expiresAt: session.expiresAt }, [], []) }
    }

    const definition = Object.hasOwn(options.actions, name) ? options.actions[name] : undefined
    if (!definition) return { done: fail(404, 'unknown_action', `Unknown action: ${name}`) }

    const body = await readActionBody(request)
    if ('error' in body) return { done: body.error }

    const caller = callerFor(request)
    if (definition.requiresAdmin && !caller?.admin) {
      return { done: fail(caller ? 403 : 401, caller ? 'admin_only' : 'unauthenticated', `Action ${name} is for the world's owner`) }
    }
    if ((definition.requiresCaller ?? true) && !caller) {
      return { done: fail(401, 'unauthenticated', `Action ${name} needs a session: call ${SESSION_ACTION} first and send its token as a Bearer token`) }
    }
    if (!body.target && definition.targetTypes) {
      return { done: fail(400, 'invalid_target', `Action ${name} needs a target of type ${definition.targetTypes.join(' or ')}`) }
    }

    let prepared: JsonValue | undefined
    if (definition.prepare) {
      try {
        prepared = await definition.prepare({ input: body.input, caller, request })
      } catch (error) {
        if (error instanceof ActionError) return { done: fail(error.status, error.code, error.message, error.details) }
        throw error
      }
    }
    return { definition, body, caller, prepared }
  }

  const execute = async (name: string, request: Request, ready: Exclude<Preflight, { done: DispatchResult }>): Promise<DispatchResult> => {
    const { definition, body, caller, prepared } = ready
    let target: EntityEnvelope | null = null
    if (body.target) {
      target = options.store.get(body.target.type, body.target.id)
      if (!target || target.visibility !== 'public') return fail(404, 'entity_not_found', 'Target entity not found')
      if (definition.targetTypes && !definition.targetTypes.includes(target.ref.type)) {
        return fail(400, 'invalid_target', `Action ${name} cannot target ${target.ref.type}`)
      }
      // A stale view comes first: the caller learns what changed, not just that they can't act.
      if (body.ifVersion !== null && target.version !== body.ifVersion) {
        const error = versionConflict(target)
        return fail(error.status, error.code, error.message, error.details)
      }
      if (!target.capabilities.includes(name)) {
        return fail(403, 'not_allowed', `${target.ref.type}/${target.ref.id} does not allow ${name} right now`)
      }
    }

    const recording = options.store.recording()
    try {
      const output = await definition.handler({
        input: body.input,
        target,
        ifVersion: body.ifVersion,
        caller,
        world: recording.store,
        request,
        prepared: prepared ?? null,
      })
      const { changed, removed } = recording.finish()
      return ok(output ?? null, changed, removed)
    } catch (error) {
      if (error instanceof ActionError) return fail(error.status, error.code, error.message, error.details)
      throw error
    }
  }

  return {
    names,
    callerFor,
    async dispatch(name, request) {
      const ready = await preflight(name, request)
      if ('done' in ready) return ready.done
      // One action at a time: a handler may read, await, then write without another action
      // changing the world in between.
      return queue.run(() => execute(name, request, ready))
    },
  }
}

type ParsedBody =
  | { input: JsonObject; target: { type: string; id: string } | null; ifVersion: number | null }
  | { error: DispatchResult }

async function readActionBody(request: Request): Promise<ParsedBody> {
  let value: unknown
  try {
    const text = await request.text()
    value = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return { error: fail(400, 'invalid_json', 'Request body must be a JSON object') }
  }
  if (!isRecord(value)) return { error: fail(400, 'invalid_json', 'Request body must be a JSON object') }

  const input = value.input ?? {}
  if (!isRecord(input)) return { error: fail(400, 'invalid_input', 'input must be a JSON object') }

  let target: { type: string; id: string } | null = null
  if (value.target !== undefined && value.target !== null) {
    const raw = value.target
    if (!isRecord(raw) || typeof raw.type !== 'string' || typeof raw.id !== 'string' || !raw.type || !raw.id) {
      return { error: fail(400, 'invalid_target', 'target must be { "type": string, "id": string }') }
    }
    target = { type: raw.type, id: raw.id }
  }

  let ifVersion: number | null = null
  if (value.ifVersion !== undefined && value.ifVersion !== null) {
    if (!Number.isSafeInteger(value.ifVersion) || (value.ifVersion as number) < 0) {
      return { error: fail(400, 'invalid_if_version', 'ifVersion must be a non-negative integer') }
    }
    if (!target) return { error: fail(400, 'invalid_if_version', 'ifVersion needs a target') }
    ifVersion = value.ifVersion as number
  }

  return { input: input as JsonObject, target, ifVersion }
}

function ok(output: JsonValue | null, changed: EntityEnvelope[], removed: EntityRef[]): DispatchResult {
  return {
    status: 200,
    body: {
      output,
      changed: changed as unknown as JsonValue,
      removed: removed as unknown as JsonValue,
    },
  }
}

function fail(status: number, code: string, message: string, details?: JsonValue): DispatchResult {
  return { status, body: details === undefined ? { code, message } : { code, message, details } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}
