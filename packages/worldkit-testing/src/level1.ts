import { WorldClient, discoverWorld, type Fetch } from '@worlddevkit/client'
import {
  WORLD_PROTOCOL_VERSION,
  type EntityEnvelope,
  type PaginatedEntityCollection,
  type ProtocolError,
  type WorldDiscoveryDocument,
} from '@worlddevkit/spec'

export type Level1CheckName =
  | 'discovery-document'
  | 'entity-envelope-validity'
  | 'pagination-termination'
  | 'list-get-consistency'
  | 'unknown-entity-protocol-errors'
  | 'public-read-cors'
  | 'discover-route'
  | 'no-unadvertised-entity-types'

export interface Level1ConformanceTarget {
  /** Any URL on the world origin. Discovery is requested from `/.well-known/world.json`. */
  world: string | URL
  /** Supply a handler-backed Fetch implementation for in-memory testing. Defaults to global Fetch. */
  fetch?: Fetch
}

export interface Level1ConformanceOptions {
  /** Page size used to force traversal of paginated collections. */
  pageSize?: number
  /** Safety bound for a broken endpoint that continually emits fresh cursors. */
  maxPagesPerType?: number
  /** Browser origin used for public-read CORS checks. */
  corsOrigin?: string
}

export interface Level1ConformanceCheck {
  name: Level1CheckName
  passed: boolean
  durationMs: number
  error?: string
}

export interface Level1ConformanceReport {
  level: 1
  passed: boolean
  world: string
  protocol?: string
  checks: Level1ConformanceCheck[]
}

export class Level1ConformanceError extends Error {
  readonly report: Level1ConformanceReport

  constructor(report: Level1ConformanceReport) {
    const failures = report.checks.filter((check) => !check.passed)
    super(`World Protocol Level 1 conformance failed: ${failures.map((check) => check.name).join(', ')}`)
    this.name = 'Level1ConformanceError'
    this.report = report
  }
}

interface ScanResult {
  entities: EntityEnvelope[]
  byType: Map<string, EntityEnvelope[]>
  paginationErrors: string[]
}

interface RunnerContext {
  discovery?: WorldDiscoveryDocument
  client?: WorldClient
  scan?: ScanResult
  discoverEntities?: EntityEnvelope[]
}

const CHECK_NAMES: readonly Level1CheckName[] = [
  'discovery-document',
  'entity-envelope-validity',
  'pagination-termination',
  'list-get-consistency',
  'unknown-entity-protocol-errors',
  'public-read-cors',
  'discover-route',
  'no-unadvertised-entity-types',
]

export async function runLevel1Conformance(
  target: Level1ConformanceTarget,
  options: Level1ConformanceOptions = {},
): Promise<Level1ConformanceReport> {
  const fetch = resolveFetch(target.fetch)
  const worldUrl = new URL(target.world)
  const pageSize = options.pageSize ?? 50
  const maxPagesPerType = options.maxPagesPerType ?? 1_000
  const corsOrigin = options.corsOrigin ?? 'https://worldkit-conformance.invalid'
  requirePositiveInteger(pageSize, 'pageSize')
  requirePositiveInteger(maxPagesPerType, 'maxPagesPerType')

  const context: RunnerContext = {}
  const checks: Level1ConformanceCheck[] = []
  const run = async (name: Level1CheckName, check: () => Promise<void>): Promise<void> => {
    const started = performance.now()
    try {
      await check()
      checks.push({ name, passed: true, durationMs: elapsed(started) })
    } catch (error) {
      checks.push({ name, passed: false, durationMs: elapsed(started), error: errorMessage(error) })
    }
  }

  await run('discovery-document', async () => {
    const discovery = await discoverWorld(worldUrl, { fetch })
    assertDiscoveryDocument(discovery)
    context.discovery = discovery
    context.client = new WorldClient(discovery, { fetch })
  })

  await run('entity-envelope-validity', async () => {
    const { discovery, client } = requireWorld(context)
    context.scan = await scanEntities(client, discovery, pageSize, maxPagesPerType)
  })

  await run('pagination-termination', async () => {
    const scan = requireScan(context)
    assert(scan.paginationErrors.length === 0, scan.paginationErrors.join('; '))
  })

  await run('list-get-consistency', async () => {
    const { client } = requireWorld(context)
    const scan = requireScan(context)
    for (const entity of scan.entities) {
      const fetched = await client.getEntity(entity.ref.type, entity.ref.id)
      assertEntityEnvelope(fetched, requireDiscovery(context), entity.ref.type)
      assert(canonicalJson(fetched) === canonicalJson(entity), `GET disagrees with list for ${entity.ref.type}/${entity.ref.id}`)
    }
  })

  await run('unknown-entity-protocol-errors', async () => {
    const discovery = requireDiscovery(context)
    const unknownType = uniqueUnknownType(discovery.entityTypes)
    const listUrl = apiUrl(discovery, `entities/${encodeURIComponent(unknownType)}`)
    const missingEntityUrl = apiUrl(
      discovery,
      `entities/${encodeURIComponent(discovery.entityTypes[0] ?? unknownType)}/worldkit-conformance-missing`,
    )
    await assertProtocolErrorResponse(fetch, listUrl, 'unknown entity type list')
    await assertProtocolErrorResponse(fetch, missingEntityUrl, 'unknown entity get')
  })

  await run('public-read-cors', async () => {
    const discovery = requireDiscovery(context)
    const scan = requireScan(context)
    const urls = [new URL('/.well-known/world.json', worldUrl)]
    for (const type of discovery.entityTypes) urls.push(apiUrl(discovery, `entities/${encodeURIComponent(type)}?limit=1`))
    const publicEntity = scan.entities.find((entity) => entity.visibility === 'public')
    if (publicEntity) {
      urls.push(apiUrl(discovery, `entities/${encodeURIComponent(publicEntity.ref.type)}/${encodeURIComponent(publicEntity.ref.id)}`))
    }
    for (const url of urls) {
      const response = await fetch(url, { headers: { origin: corsOrigin } })
      assert(response.ok, `CORS probe returned HTTP ${response.status} for ${url.href}`)
      const allowedOrigin = response.headers.get('access-control-allow-origin')
      assert(allowedOrigin === '*' || allowedOrigin === corsOrigin, `Missing public-read CORS allowance for ${url.href}`)
    }
  })

  await run('discover-route', async () => {
    const { discovery, client } = requireWorld(context)
    const collection = await client.discover({ limit: 2 })
    assertEntityCollection(collection, 'discover route')
    for (const entity of collection.entities) assertEntityEnvelope(entity, discovery)
    context.discoverEntities = collection.entities
  })

  await run('no-unadvertised-entity-types', async () => {
    const discovery = requireDiscovery(context)
    const scan = requireScan(context)
    assert(context.discoverEntities !== undefined, 'Discover route prerequisite failed')
    for (const entity of [...scan.entities, ...context.discoverEntities]) {
      assert(discovery.entityTypes.includes(entity.ref.type), `Response exposed unadvertised entity type: ${entity.ref.type}`)
    }
  })

  assert(checks.length === CHECK_NAMES.length, 'Internal error: incomplete conformance report')
  return {
    level: 1,
    passed: checks.every((check) => check.passed),
    world: worldUrl.href,
    ...(context.discovery ? { protocol: context.discovery.protocol } : {}),
    checks,
  }
}

export async function assertLevel1Conformance(
  target: Level1ConformanceTarget,
  options: Level1ConformanceOptions = {},
): Promise<Level1ConformanceReport> {
  const report = await runLevel1Conformance(target, options)
  if (!report.passed) throw new Level1ConformanceError(report)
  return report
}

async function scanEntities(
  client: WorldClient,
  discovery: WorldDiscoveryDocument,
  pageSize: number,
  maxPagesPerType: number,
): Promise<ScanResult> {
  const entities: EntityEnvelope[] = []
  const byType = new Map<string, EntityEnvelope[]>()
  const paginationErrors: string[] = []
  for (const type of discovery.entityTypes) {
    const typeEntities: EntityEnvelope[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    while (true) {
      if (pages >= maxPagesPerType) {
        paginationErrors.push(`Pagination did not terminate for ${type} within ${maxPagesPerType} pages`)
        break
      }
      pages += 1
      const page: PaginatedEntityCollection = await client.listEntities(type, { cursor, limit: pageSize })
      assertEntityCollection(page, `entity list for ${type}`)
      for (const entity of page.entities) {
        assertEntityEnvelope(entity, discovery, type)
        typeEntities.push(entity)
        entities.push(entity)
      }
      cursor = page.nextCursor
      if (cursor === null) break
      if (seenCursors.has(cursor)) {
        paginationErrors.push(`Pagination repeated cursor for ${type}: ${cursor}`)
        break
      }
      seenCursors.add(cursor)
    }
    byType.set(type, typeEntities)
  }
  return { entities, byType, paginationErrors }
}

function assertDiscoveryDocument(value: WorldDiscoveryDocument): void {
  assert(value.protocol === WORLD_PROTOCOL_VERSION, `Unsupported protocol version: ${String(value.protocol)}`)
  assertHttpsUrl(value.id, 'discovery id')
  assert(nonEmptyString(value.name), 'Discovery name must be non-empty')
  assert(isRecord(value.endpoints), 'Discovery endpoints must be an object')
  assertAbsoluteUrl(value.endpoints.api, 'discovery API endpoint')
  assert(Array.isArray(value.entityTypes), 'Discovery entityTypes must be an array')
  assert(value.entityTypes.length > 0, 'Discovery must advertise at least one entity type')
  assert(value.entityTypes.every(nonEmptyString), 'Discovery entity types must be non-empty strings')
  assert(new Set(value.entityTypes).size === value.entityTypes.length, 'Discovery entity types must be unique')
  assert(value.actions?.includes('wp:discover') === true, 'Level 1 discovery must advertise wp:discover')
}

function assertEntityCollection(value: unknown, label: string): asserts value is PaginatedEntityCollection {
  assert(isRecord(value), `${label} must return an object`)
  assert(Array.isArray(value.entities), `${label}.entities must be an array`)
  assert(value.nextCursor === null || typeof value.nextCursor === 'string', `${label}.nextCursor must be a string or null`)
}

function assertEntityEnvelope(value: unknown, discovery: WorldDiscoveryDocument, requestedType?: string): asserts value is EntityEnvelope {
  assert(isRecord(value), 'Entity envelope must be an object')
  assert(isRecord(value.ref), 'Entity ref must be an object')
  assert(value.ref.world === discovery.id, `Entity ref.world must equal discovery id: ${discovery.id}`)
  assert(nonEmptyString(value.ref.type), 'Entity ref.type must be non-empty')
  assert(nonEmptyString(value.ref.id), 'Entity ref.id must be non-empty')
  if (requestedType !== undefined) assert(value.ref.type === requestedType, `Entity type ${value.ref.type} appeared in ${requestedType} list`)
  assert(Number.isInteger(value.version) && Number(value.version) >= 0, 'Entity version must be a non-negative integer')
  assert(nonEmptyString(value.updatedAt) && !Number.isNaN(Date.parse(value.updatedAt)), 'Entity updatedAt must be a date-time string')
  assert(value.visibility === 'public' || value.visibility === 'connections' || value.visibility === 'private', 'Entity visibility is invalid')
  assert(isRecord(value.attributes), 'Entity attributes must be an object')
  assert(Array.isArray(value.relationships), 'Entity relationships must be an array')
  assert(Array.isArray(value.capabilities) && value.capabilities.every(nonEmptyString), 'Entity capabilities must be non-empty strings')
  for (const relationship of value.relationships) {
    assert(isRecord(relationship) && nonEmptyString(relationship.rel), 'Entity relationship rel must be non-empty')
    assert(isRecord(relationship.target), 'Entity relationship target must be an object')
    assert(nonEmptyString(relationship.target.type) && nonEmptyString(relationship.target.id), 'Entity relationship target is invalid')
  }
}

async function assertProtocolErrorResponse(fetch: Fetch, url: URL, label: string): Promise<void> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  assert(response.status >= 400 && response.status < 500, `${label} must return a 4xx status, received ${response.status}`)
  const value = await readJson(response, label)
  const candidate = isRecord(value) && isRecord(value.error) ? value.error : value
  assertProtocolError(candidate, label)
}

function assertProtocolError(value: unknown, label: string): asserts value is ProtocolError {
  assert(isRecord(value), `${label} must return a protocol error object`)
  assert(nonEmptyString(value.code), `${label} protocol error code must be non-empty`)
  assert(nonEmptyString(value.message), `${label} protocol error message must be non-empty`)
}

function requireWorld(context: RunnerContext): { discovery: WorldDiscoveryDocument; client: WorldClient } {
  assert(context.discovery !== undefined && context.client !== undefined, 'Discovery document prerequisite failed')
  return { discovery: context.discovery, client: context.client }
}

function requireDiscovery(context: RunnerContext): WorldDiscoveryDocument {
  assert(context.discovery !== undefined, 'Discovery document prerequisite failed')
  return context.discovery
}

function requireScan(context: RunnerContext): ScanResult {
  assert(context.scan !== undefined, 'Entity scan prerequisite failed')
  return context.scan
}

function apiUrl(discovery: WorldDiscoveryDocument, path: string): URL {
  return new URL(`${discovery.endpoints.api.replace(/\/+$/, '')}/${path}`)
}

function uniqueUnknownType(entityTypes: readonly string[]): string {
  let candidate = 'worldkit:conformance-unknown'
  while (entityTypes.includes(candidate)) candidate += '-unknown'
  return candidate
}

function resolveFetch(fetch?: Fetch): Fetch {
  const implementation = fetch ?? globalThis.fetch
  if (implementation === undefined) throw new Error('No Fetch implementation is available')
  return implementation.bind(globalThis) as Fetch
}

async function readJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json()
  } catch (cause) {
    throw new Error(`${label} returned invalid JSON`, { cause })
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function assertAbsoluteUrl(value: unknown, label: string): asserts value is string {
  assert(nonEmptyString(value), `${label} must be a non-empty URL`)
  try {
    new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute URL`)
  }
}

function assertHttpsUrl(value: unknown, label: string): asserts value is string {
  assertAbsoluteUrl(value, label)
  assert(new URL(value).protocol === 'https:', `${label} must use HTTPS`)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requirePositiveInteger(value: number, label: string): void {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
