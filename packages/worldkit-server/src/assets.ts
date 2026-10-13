/**
 * Assets and placements: one world's products shown inside another world.
 *
 * A **publisher** world exposes `wp:asset` entities: a name, an image, optionally a 3D model, a
 * link back, and which hosts may show it. Publishing an asset is the opt-in.
 *
 * A **host** world accepts offers (`wp:offer`), which its owner approves (`wp:accept`) up to a
 * limit, and shows each accepted asset as a public `wp:placement` entity: a sanitized copy of
 * the asset with a "presented by" label and a link back. The host keeps placements in sync with
 * their source and drops them when the source withdraws them.
 */
import type { EntityEnvelope, EntityRef, JsonObject, JsonValue, WorldDiscoveryDocument } from '@worlddevkit/spec'

import { ActionError, type ActionRegistry, type WorldStore } from './level2.js'
import type { WorldEntityInput } from './world.js'

export const ASSET_TYPE = 'wp:asset'
export const PLACEMENT_TYPE = 'wp:placement'
export const ASSETS_EXTENSION = 'wp:assets'
export const PLACEMENTS_EXTENSION = 'wp:placements'

const LIMITS = {
  name: 80,
  description: 280,
  alt: 140,
  url: 2048,
  modelBytes: 10_000_000,
  imageSide: 8192,
  responseBytes: 256 * 1024,
  timeoutMs: 5_000,
  pendingOffers: 20,
} as const

// ---------------------------------------------------------------------------------------------
// The asset format

export interface AssetImage {
  url: string
  alt: string
  width?: number
  height?: number
}

export interface AssetModel {
  url: string
  format: 'glb'
  /** Size of the file in bytes. Hosts refuse models over 10 MB. */
  bytes: number
}

export interface AssetPrice {
  /** In the currency's minor unit (kobo for NGN, cents for USD). */
  amount: number
  currency: string
}

export interface AssetInput {
  id: string
  name: string
  description?: string
  image: AssetImage
  model?: AssetModel
  /** The page where people can see or buy the real thing. */
  web: string
  price?: AssetPrice
  /** Hosts allowed to show this asset: `'any'` (the default) or a list of world origins. */
  hosts?: 'any' | readonly string[]
  /** A relationship to the entity this asset represents, such as a product in this world. */
  represents?: { type: string; id: string }
  version?: number
  updatedAt?: string
}

/** The sanitized asset a host keeps and serves inside a placement. */
export interface AssetSnapshot extends JsonObject {
  name: string
  description: string | null
  image: { url: string; alt: string; width: number | null; height: number | null }
  model: { url: string; format: 'glb'; bytes: number } | null
  web: string
  price: { amount: number; currency: string } | null
}

/**
 * Builds a `wp:asset` entity for `defineWorld`. The same rules hosts apply are checked here,
 * so a mistake shows up when the world starts, not when a host refuses the asset.
 */
export function defineAsset(input: AssetInput, options: { allowLocal?: boolean } = {}): WorldEntityInput {
  const attributes: JsonObject = {
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    category: 'asset',
    image: { ...input.image } as JsonObject,
    ...(input.model ? { model: { ...input.model } as JsonObject } : {}),
    ...(input.price ? { price: { ...input.price } as JsonObject } : {}),
    placement: { hosts: input.hosts === undefined || input.hosts === 'any' ? 'any' : [...input.hosts] },
  }
  const checked = sanitizeAsset({ attributes, links: { web: input.web } }, options)
  if (!checked.ok) throw new Error(`defineAsset ${input.id}: ${checked.error}`)
  return {
    type: ASSET_TYPE,
    id: input.id,
    attributes,
    links: { web: input.web },
    relationships: input.represents ? [{ rel: 'represents', target: input.represents }] : [],
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
  }
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Validates an asset entity and returns the snapshot a host may show. Text is trimmed, control
 * characters removed and lengths capped; only http(s) image, model and web links are allowed.
 */
export function sanitizeAsset(
  entity: Pick<EntityEnvelope, 'attributes'> & { links?: Record<string, string> | undefined },
  options: { allowLocal?: boolean } = {},
): Checked<AssetSnapshot> {
  const a = entity.attributes as Record<string, unknown>
  const name = cleanText(a.name, LIMITS.name)
  if (!name) return { ok: false, error: 'an asset needs a name' }
  const description = cleanText(a.description, LIMITS.description) || null

  const image = a.image as Record<string, unknown> | undefined
  if (!isRecord(image)) return { ok: false, error: 'an asset needs an image: { url, alt }' }
  const imageUrl = checkUrl(image.url, options)
  if (!imageUrl.ok) return { ok: false, error: `image url ${imageUrl.error}` }
  const alt = cleanText(image.alt, LIMITS.alt)
  if (!alt) return { ok: false, error: 'image alt text is required, so everyone knows what the picture shows' }
  const width = optionalSide(image.width)
  const height = optionalSide(image.height)
  if (width === undefined || height === undefined) return { ok: false, error: `image width and height must be whole numbers up to ${LIMITS.imageSide}` }

  let model: AssetSnapshot['model'] = null
  if (a.model !== undefined && a.model !== null) {
    const raw = a.model as Record<string, unknown>
    if (!isRecord(raw)) return { ok: false, error: 'model must be { url, format: "glb", bytes }' }
    const modelUrl = checkUrl(raw.url, options)
    if (!modelUrl.ok) return { ok: false, error: `model url ${modelUrl.error}` }
    if (raw.format !== 'glb') return { ok: false, error: 'model format must be "glb"' }
    if (!Number.isSafeInteger(raw.bytes) || (raw.bytes as number) <= 0 || (raw.bytes as number) > LIMITS.modelBytes) {
      return { ok: false, error: `model bytes must be a whole number up to ${LIMITS.modelBytes}` }
    }
    model = { url: modelUrl.value, format: 'glb', bytes: raw.bytes as number }
  }

  const web = checkUrl(entity.links?.web, options)
  if (!web.ok) return { ok: false, error: `links.web ${web.error}` }

  let price: AssetSnapshot['price'] = null
  if (a.price !== undefined && a.price !== null) {
    const raw = a.price as Record<string, unknown>
    if (!isRecord(raw) || !Number.isSafeInteger(raw.amount) || (raw.amount as number) < 0 || typeof raw.currency !== 'string' || !/^[A-Za-z0-9:._-]{3,40}$/.test(raw.currency)) {
      return { ok: false, error: 'price must be { amount: whole number in minor units, currency: code }' }
    }
    price = { amount: raw.amount as number, currency: raw.currency }
  }

  return {
    ok: true,
    value: { name, description, image: { url: imageUrl.value, alt, width, height }, model, web: web.value, price },
  }
}

/** Whether an asset's own `placement.hosts` lets `hostWorld` show it. */
export function assetAllowsHost(asset: Pick<EntityEnvelope, 'attributes'>, hostWorld: string): boolean {
  const placement = (asset.attributes as Record<string, unknown>).placement
  if (!isRecord(placement) || placement.hosts === undefined || placement.hosts === 'any') return true
  return Array.isArray(placement.hosts) && placement.hosts.some((host) => typeof host === 'string' && sameOrigin(host, hostWorld))
}

// ---------------------------------------------------------------------------------------------
// Fetching from other worlds, safely

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface RemoteOptions {
  fetch: Fetch
  /** Allow http:// and loopback addresses, for local development and tests. Never in production. */
  allowLocal?: boolean
}

export interface FetchedAsset {
  ref: EntityRef
  worldName: string
  version: number
  updatedAt: string
  entity: EntityEnvelope
  snapshot: AssetSnapshot
}

/**
 * Fetches an asset from its own world and validates it: the world's discovery must claim the
 * same identity, advertise `wp:asset`, and serve the asset publicly. Refusals throw
 * `ActionError` with a plain message.
 */
export async function fetchRemoteAsset(ref: EntityRef, remote: RemoteOptions): Promise<FetchedAsset> {
  if (ref.type !== ASSET_TYPE) throw new ActionError('not_an_asset', `Only ${ASSET_TYPE} entities can be placed`, 400)
  const origin = checkUrl(ref.world, remote)
  if (!origin.ok) throw new ActionError('invalid_world', `World ${origin.error}`, 400)
  const worldUrl = new URL(origin.value)
  if (worldUrl.pathname !== '/' || worldUrl.search) throw new ActionError('invalid_world', 'World must be an origin, like https://shop.example', 400)

  const discovery = await fetchJson(new URL('/.well-known/world.json', worldUrl), remote) as WorldDiscoveryDocument
  if (!isRecord(discovery) || discovery.id === undefined || !sameOrigin(String(discovery.id), worldUrl.origin)) {
    throw new ActionError('invalid_world', 'That world does not identify itself at its own address', 422)
  }
  if (!Array.isArray(discovery.entityTypes) || !discovery.entityTypes.includes(ASSET_TYPE)) {
    throw new ActionError('no_assets', 'That world does not publish assets', 422)
  }
  const api = checkUrl(discovery.endpoints?.api, remote)
  if (!api.ok || !sameOrigin(api.value, worldUrl.origin)) throw new ActionError('invalid_world', 'That world’s API is not on its own address', 422)

  const entity = await fetchJson(new URL(`${api.value.replace(/\/+$/, '')}/entities/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`), remote, true) as EntityEnvelope | null
  if (!entity || !isRecord(entity) || entity.visibility !== 'public' || entity.ref?.type !== ASSET_TYPE || entity.ref?.id !== ref.id) {
    throw new ActionError('asset_not_found', 'That asset is not available', 404)
  }
  const checked = sanitizeAsset(entity, remote)
  if (!checked.ok) throw new ActionError('invalid_asset', `That asset cannot be shown: ${checked.error}`, 422)
  return {
    ref: { world: worldUrl.origin, type: ASSET_TYPE, id: ref.id },
    worldName: cleanText(discovery.name, LIMITS.name) || worldUrl.hostname,
    version: Number.isSafeInteger(entity.version) ? entity.version : 0,
    updatedAt: typeof entity.updatedAt === 'string' ? entity.updatedAt : new Date(0).toISOString(),
    entity,
    snapshot: checked.value,
  }
}

async function fetchJson(url: URL, remote: RemoteOptions, notFoundIsNull = false): Promise<unknown> {
  const safe = checkUrl(url.href, remote)
  if (!safe.ok) throw new ActionError('invalid_world', `World ${safe.error}`, 400)
  let response: Response
  try {
    response = await remote.fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(LIMITS.timeoutMs) })
  } catch {
    throw new ActionError('world_unreachable', 'Could not reach that world. Try again later.', 502)
  }
  if (notFoundIsNull && response.status === 404) return null
  if (!response.ok) throw new ActionError('world_unreachable', `That world answered HTTP ${response.status}`, 502)
  const text = await readCapped(response, LIMITS.responseBytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new ActionError('invalid_world', 'That world returned something that is not JSON', 502)
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ActionError('invalid_world', 'That world sent too much data', 502)
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

// ---------------------------------------------------------------------------------------------
// Hosting placements

export interface PlacementPolicy {
  /** How many placements can be shown at once. Defaults to 5. */
  max?: number
  /** `manual` (the default): the owner accepts each offer. `auto`: offers are shown at once while there is room. */
  accept?: 'manual' | 'auto'
  /** Only accept assets from these world origins. Defaults to any world. */
  fromWorlds?: readonly string[]
  /** Allow http:// and loopback worlds, for local development and tests only. */
  allowLocal?: boolean
  /** Fetch implementation for reaching other worlds. Defaults to global fetch. */
  fetch?: Fetch
}

export interface PlacementSyncReport {
  checked: number
  updated: number
  removed: number
  failed: number
}

export interface PlacementHost {
  actions: ActionRegistry
  /**
   * Re-fetch every placement from its source: update changed ones, drop withdrawn ones. Run it
   * on a timer with `start`, or call it after a source tells you something changed.
   */
  sync(): Promise<PlacementSyncReport>
  /**
   * Listen to each source world's events stream (when it has one) and sync as soon as a placed
   * asset changes. Returns a function that stops listening. Sources are re-checked every
   * `recheckMs`, so newly placed worlds are picked up.
   */
  watchSources(recheckMs?: number): () => void
}

/**
 * Creates the placement actions for a host world. `defineWorld({ placements })` wires this up;
 * use it directly only with `createWorldHandler`.
 */
export function createPlacementHost(
  hostWorld: string,
  policy: PlacementPolicy,
  world: { read: Pick<WorldStore, 'get' | 'list'>; change<T>(task: (store: WorldStore) => T | Promise<T>): Promise<T> },
): PlacementHost {
  const max = Math.max(0, Math.floor(policy.max ?? 5))
  const accept = policy.accept ?? 'manual'
  const remote: RemoteOptions = { fetch: policy.fetch ?? globalThis.fetch.bind(globalThis), allowLocal: policy.allowLocal === true }
  const fromWorlds = policy.fromWorlds?.map((origin) => new URL(origin).origin)

  const placedCount = (store: Pick<WorldStore, 'list'>) => store.list(PLACEMENT_TYPE).filter((entity) => entity.attributes.status === 'placed').length

  const actions: ActionRegistry = {
    'wp:offer': {
      async prepare({ input }) {
        const asset = input.asset
        if (!isRecord(asset) || typeof asset.world !== 'string' || typeof asset.id !== 'string') {
          throw new ActionError('invalid_input', 'Offer an asset as { "asset": { "world": "https://…", "id": "…" } }', 400)
        }
        const checked = checkUrl(asset.world, remote)
        if (!checked.ok) throw new ActionError('invalid_world', `asset.world ${checked.error}`, 400)
        const origin = safeOrigin(checked.value)
        if (!origin) throw new ActionError('invalid_world', 'asset.world must be a world origin, like https://shop.example', 400)
        if (sameOrigin(origin, hostWorld)) throw new ActionError('same_world', 'A world cannot place its own assets', 400)
        if (fromWorlds && !fromWorlds.includes(origin)) throw new ActionError('world_not_allowed', 'This world does not take assets from that world', 403)
        const fetched = await fetchRemoteAsset({ world: origin, type: ASSET_TYPE, id: asset.id }, remote)
        if (!assetAllowsHost(fetched.entity, hostWorld)) {
          throw new ActionError('host_not_allowed', 'The asset’s owner has not allowed it to appear in this world', 403)
        }
        return toPrepared(fetched)
      },
      handler({ prepared, world }) {
        const fetched = fromPrepared(prepared)
        const id = placementId(fetched.ref)
        const existing = world.get(PLACEMENT_TYPE, id)
        if (existing) {
          throw new ActionError(existing.attributes.status === 'placed' ? 'already_placed' : 'already_offered', 'That asset has already been offered here', 409)
        }
        const pending = world.list(PLACEMENT_TYPE).filter((entity) => entity.attributes.status === 'offered').length
        const autoPlace = accept === 'auto' && placedCount(world) < max
        if (!autoPlace && pending >= LIMITS.pendingOffers) {
          throw new ActionError('too_many_offers', 'This world has too many offers waiting. Try again later.', 429)
        }
        const now = new Date().toISOString()
        world.create({
          type: PLACEMENT_TYPE,
          id,
          visibility: autoPlace ? 'public' : 'private',
          ...placementShape(fetched, {
            status: autoPlace ? 'placed' : 'offered',
            slot: null,
            offeredAt: now,
            placedAt: autoPlace ? now : null,
            refreshedAt: now,
          }),
        })
        return { placement: id, status: autoPlace ? 'placed' : 'offered' }
      },
    },

    'wp:accept': {
      requiresAdmin: true,
      handler({ input, world }) {
        const id = placementInput(input)
        const placement = world.get(PLACEMENT_TYPE, id)
        if (!placement) throw new ActionError('placement_not_found', 'No such offer', 404)
        if (placement.attributes.status === 'placed') throw new ActionError('already_placed', 'That asset is already shown', 409)
        if (placedCount(world) >= max) throw new ActionError('host_full', `This world already shows ${max} placed assets. Remove one first.`, 409)
        const slot = typeof input.slot === 'string' ? input.slot.slice(0, 40) : null
        world.update(PLACEMENT_TYPE, id, {
          visibility: 'public',
          attributes: { status: 'placed', slot, placedAt: new Date().toISOString() },
        })
        return { placement: id, status: 'placed', slot }
      },
    },

    'wp:remove': {
      requiresAdmin: true,
      handler({ input, world }) {
        const id = placementInput(input)
        if (!world.remove(PLACEMENT_TYPE, id)) throw new ActionError('placement_not_found', 'No such placement', 404)
        return { removed: id }
      },
    },

    'wp:placements': {
      requiresAdmin: true,
      handler({ world }) {
        return {
          max,
          accept,
          placements: world.list(PLACEMENT_TYPE).map((entity) => ({
            id: entity.ref.id,
            status: entity.attributes.status as string,
            name: entity.attributes.name as string,
            from: (entity.attributes.source as JsonObject).worldName as string,
            asset: entity.attributes.asset as JsonObject,
            slot: (entity.attributes.slot as string | null) ?? null,
          })),
        }
      },
    },
  }

  let syncing: Promise<PlacementSyncReport> | null = null
  let again = false
  const syncSoon = (): void => {
    if (syncing) {
      again = true
      return
    }
    syncing = host.sync().finally(() => {
      syncing = null
      if (again) {
        again = false
        syncSoon()
      }
    })
    syncing.catch((error: unknown) => console.error('[WorldKit] Placement sync failed:', error instanceof Error ? error.message : error))
  }

  const host: PlacementHost = {
    actions,
    watchSources(recheckMs = 60_000) {
      const watchers = new Map<string, AbortController>()
      let stopped = false
      const refreshWatchers = async () => {
        if (stopped) return
        const sources = new Set(world.read.list(PLACEMENT_TYPE).map((entity) => String((entity.attributes.source as JsonObject).world)))
        for (const [origin, controller] of watchers) {
          if (!sources.has(origin)) {
            controller.abort()
            watchers.delete(origin)
          }
        }
        for (const origin of sources) {
          if (watchers.has(origin)) continue
          const controller = new AbortController()
          watchers.set(origin, controller)
          void watchSource(origin, remote, controller.signal, (ref) => {
            // '*' means the source could not replay what we missed: check everything.
            if (ref.id === '*' || world.read.get(PLACEMENT_TYPE, placementId(ref))) syncSoon()
          }).finally(() => {
            if (watchers.get(origin) === controller) watchers.delete(origin)
          })
        }
      }
      void refreshWatchers()
      const timer = setInterval(() => void refreshWatchers(), Math.max(5_000, recheckMs))
      ;(timer as { unref?: () => void }).unref?.()
      return () => {
        stopped = true
        clearInterval(timer)
        for (const controller of watchers.values()) controller.abort()
        watchers.clear()
      }
    },
    async sync() {
      const report: PlacementSyncReport = { checked: 0, updated: 0, removed: 0, failed: 0 }
      const current = world.read.list(PLACEMENT_TYPE)
      // Fetch outside the queue, then apply each result in one quick change.
      const results = await Promise.all(current.map(async (placement) => {
        const source = placement.attributes.source as JsonObject
        const ref: EntityRef = { world: String(source.world), type: ASSET_TYPE, id: String(source.id) }
        try {
          const fetched = await fetchRemoteAsset(ref, remote)
          return { placement, fetched, allowed: assetAllowsHost(fetched.entity, hostWorld) }
        } catch (error) {
          const gone = error instanceof ActionError && ['asset_not_found', 'invalid_asset', 'no_assets'].includes(error.code)
          return { placement, gone, error }
        }
      }))
      await world.change((store) => {
        for (const result of results) {
          report.checked += 1
          const id = result.placement.ref.id
          const live = store.get(PLACEMENT_TYPE, id)
          if (!live) continue
          if ('fetched' in result && result.fetched) {
            if (!result.allowed) {
              store.remove(PLACEMENT_TYPE, id)
              report.removed += 1
              continue
            }
            const source = live.attributes.source as JsonObject
            if (Number(source.version) !== result.fetched.version) {
              const shape = placementShape(result.fetched, {
                status: live.attributes.status as string,
                slot: (live.attributes.slot as string | null) ?? null,
                offeredAt: live.attributes.offeredAt as string,
                placedAt: (live.attributes.placedAt as string | null) ?? null,
                refreshedAt: new Date().toISOString(),
              })
              store.update(PLACEMENT_TYPE, id, { attributes: shape.attributes, links: shape.links, sponsorship: shape.sponsorship })
              report.updated += 1
            }
          } else if ('gone' in result && result.gone) {
            store.remove(PLACEMENT_TYPE, id)
            report.removed += 1
          } else {
            report.failed += 1
          }
        }
      })
      return report
    },
  }
  return host
}

/**
 * Follows a source world's events stream and reports asset refs that changed or were removed.
 * Ends quietly when the world has no events endpoint, refuses, or the signal aborts.
 */
async function watchSource(origin: string, remote: RemoteOptions, signal: AbortSignal, onAssetEvent: (ref: EntityRef) => void): Promise<void> {
  let discovery: WorldDiscoveryDocument
  try {
    discovery = await fetchJson(new URL('/.well-known/world.json', origin), remote) as WorldDiscoveryDocument
  } catch {
    return
  }
  const events = checkUrl(discovery?.endpoints?.events, remote)
  if (!events.ok || !sameOrigin(events.value, origin)) return
  let delay = 1_000
  while (!signal.aborted) {
    try {
      const response = await remote.fetch(events.value, { headers: { accept: 'text/event-stream' }, redirect: 'error', signal })
      if (!response.ok || !response.body) return
      delay = 1_000
      const reader = response.body.getReader()
      const cancel = () => {
        reader.cancel().catch(() => undefined)
      }
      signal.addEventListener('abort', cancel, { once: true })
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
          if (buffer.length > LIMITS.responseBytes) buffer = buffer.slice(-LIMITS.responseBytes)
          let boundary: number
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const event = /^event: ?(.*)$/m.exec(block)?.[1]
            const data = /^data: ?(.*)$/m.exec(block)?.[1]
            if (!data || (event !== 'entity.changed' && event !== 'entity.removed' && event !== 'reset')) continue
            if (event === 'reset') {
              onAssetEvent({ world: origin, type: ASSET_TYPE, id: '*' })
              continue
            }
            try {
              const parsed = JSON.parse(data) as { entity?: { ref?: EntityRef }; ref?: EntityRef }
              const ref = parsed.entity?.ref ?? parsed.ref
              if (ref?.type === ASSET_TYPE && typeof ref.id === 'string') onAssetEvent({ world: origin, type: ASSET_TYPE, id: ref.id })
            } catch {
              // Ignore malformed events from other worlds.
            }
          }
        }
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    } catch {
      if (signal.aborted) return
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 30_000)
  }
}

function placementShape(
  fetched: FetchedAsset,
  state: { status: string; slot: string | null; offeredAt: string; placedAt: string | null; refreshedAt: string },
): Pick<WorldEntityInput, 'attributes' | 'relationships' | 'links'> & { sponsorship: JsonObject } {
  const source: JsonObject = {
    world: fetched.ref.world,
    worldName: fetched.worldName,
    type: fetched.ref.type,
    id: fetched.ref.id,
    version: fetched.version,
    updatedAt: fetched.updatedAt,
  }
  return {
    attributes: {
      name: fetched.snapshot.name,
      category: 'placement',
      description: `${fetched.snapshot.name}, presented by ${fetched.worldName}.`,
      status: state.status,
      slot: state.slot,
      asset: fetched.snapshot,
      source,
      offeredAt: state.offeredAt,
      placedAt: state.placedAt,
      refreshedAt: state.refreshedAt,
    },
    relationships: [{ rel: 'shows', target: { world: fetched.ref.world, type: fetched.ref.type, id: fetched.ref.id } }],
    links: { web: fetched.snapshot.web },
    sponsorship: {
      sponsor: { name: fetched.worldName, ref: { world: fetched.ref.world, type: fetched.ref.type, id: fetched.ref.id } },
      label: 'presented_by',
    },
  }
}

function toPrepared(fetched: FetchedAsset): JsonValue {
  return { ref: fetched.ref as unknown as JsonObject, worldName: fetched.worldName, version: fetched.version, updatedAt: fetched.updatedAt, snapshot: fetched.snapshot }
}

function fromPrepared(prepared: JsonValue): FetchedAsset {
  const value = prepared as unknown as Omit<FetchedAsset, 'entity'>
  return { ...value, entity: { attributes: {} } as EntityEnvelope }
}

function placementInput(input: JsonObject): string {
  if (typeof input.placement !== 'string' || !input.placement) throw new ActionError('invalid_input', 'Send { "placement": "<id>" }', 400)
  return input.placement
}

/** Stable placement id for a source asset, so the same asset cannot be offered twice. */
export function placementId(ref: EntityRef): string {
  let hash = 0x811c9dc5
  for (const char of `${new URL(ref.world).origin}|${ref.type}|${ref.id}`) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `pl-${hash.toString(36)}-${ref.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}`
}

// ---------------------------------------------------------------------------------------------
// Helpers

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function optionalSide(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= LIMITS.imageSide ? (value as number) : undefined
}

/**
 * Accepts https URLs on public hostnames. With `allowLocal`, also http and loopback hosts.
 * Refuses credentials in URLs, private and link-local addresses, and single-label hostnames,
 * so a host cannot be tricked into fetching from its own network.
 */
export function checkUrl(value: unknown, options: { allowLocal?: boolean } = {}): Checked<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.url) return { ok: false, error: 'must be a URL' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: 'must be a full URL' }
  }
  if (url.username || url.password) return { ok: false, error: 'must not contain a username or password' }
  const local = isLocalHost(url.hostname)
  if (options.allowLocal && local && (url.protocol === 'http:' || url.protocol === 'https:')) return { ok: true, value: url.href }
  if (url.protocol !== 'https:') return { ok: false, error: 'must use https' }
  if (local || isPrivateAddress(url.hostname) || !url.hostname.includes('.')) return { ok: false, error: 'must be on a public address' }
  return { ok: true, value: url.href }
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.test') || host === '::1' || /^127\./.test(host)
}

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host)) return true
  const match = /^172\.(\d+)\./.exec(host)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true
  if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host === '::' || host.startsWith('::ffff:'))) return true
  if (host.endsWith('.internal') || host.endsWith('.local')) return true
  return false
}

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.origin === 'null' ? null : url.origin
  } catch {
    return null
  }
}

function sameOrigin(a: string, b: string): boolean {
  const left = safeOrigin(a)
  return left !== null && left === safeOrigin(b)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
