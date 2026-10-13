import { discoverWorld, type Fetch } from '@worlddevkit/client'
import type { WorldDiscoveryDocument } from '@worlddevkit/spec'

export type Level2CheckName =
  | 'level2-discovery'
  | 'session-issued'
  | 'unknown-action-error'
  | 'action-request-validation'
  | 'action-requires-session'
  | 'events-stream'

export interface Level2ConformanceTarget {
  /** Any URL on the world origin. */
  world: string | URL
  /** Supply a handler-backed Fetch implementation for in-memory testing. Defaults to global Fetch. */
  fetch?: Fetch
}

export interface Level2ConformanceOptions {
  /** How long to wait for the events stream to send its first bytes. Defaults to 5000 ms. */
  eventsTimeoutMs?: number
}

export interface Level2ConformanceCheck {
  name: Level2CheckName
  passed: boolean
  durationMs: number
  error?: string
}

export interface Level2ConformanceReport {
  level: 2
  passed: boolean
  world: string
  checks: Level2ConformanceCheck[]
}

export class Level2ConformanceError extends Error {
  readonly report: Level2ConformanceReport

  constructor(report: Level2ConformanceReport) {
    const failures = report.checks.filter((check) => !check.passed)
    super(`World Protocol Level 2 conformance failed: ${failures.map((check) => check.name).join(', ')}`)
    this.name = 'Level2ConformanceError'
    this.report = report
  }
}

const BUILT_IN_ACTIONS = new Set(['wp:discover', 'wp:session'])

/**
 * Checks the Level 2 surface: sessions, action request handling and the events stream. Run it
 * alongside `runLevel1Conformance`; a Level 2 world must pass both. It never invokes a world's
 * own actions with valid input, so it changes nothing beyond issuing one session.
 */
export async function runLevel2Conformance(
  target: Level2ConformanceTarget,
  options: Level2ConformanceOptions = {},
): Promise<Level2ConformanceReport> {
  const fetch = (target.fetch ?? globalThis.fetch).bind(globalThis) as Fetch
  const worldUrl = new URL(target.world)
  const eventsTimeoutMs = options.eventsTimeoutMs ?? 5_000
  const checks: Level2ConformanceCheck[] = []
  let discovery: WorldDiscoveryDocument | undefined
  let token: string | undefined

  const run = async (name: Level2CheckName, check: () => Promise<void>) => {
    const started = performance.now()
    try {
      await check()
      checks.push({ name, passed: true, durationMs: elapsed(started) })
    } catch (error) {
      checks.push({ name, passed: false, durationMs: elapsed(started), error: error instanceof Error ? error.message : String(error) })
    }
  }

  await run('level2-discovery', async () => {
    discovery = await discoverWorld(worldUrl, { fetch })
    assert(discovery.extensions?.includes('wp:level-2') === true, 'Discovery must list "wp:level-2" in extensions')
    assert(discovery.actions?.includes('wp:session') === true, 'Level 2 discovery must advertise wp:session')
    assert(typeof discovery.endpoints.events === 'string', 'Level 2 discovery must advertise endpoints.events')
    new URL(discovery.endpoints.events)
    assert(worldActions(discovery).length > 0, 'Level 2 discovery must advertise at least one world action')
    for (const event of ['entity.changed', 'entity.removed']) {
      assert(discovery.events?.includes(event) === true, `Level 2 discovery must list the ${event} event`)
    }
  })

  await run('session-issued', async () => {
    const world = requireDiscovery(discovery)
    const response = await postAction(fetch, world, 'wp:session', {})
    assert(response.status === 200, `wp:session returned HTTP ${response.status}`)
    const body = await response.json() as { output?: { token?: unknown; caller?: unknown; expiresAt?: unknown } }
    assert(typeof body.output?.token === 'string' && body.output.token.length >= 16, 'wp:session must return a token of at least 16 characters')
    assert(typeof body.output?.caller === 'string' && body.output.caller.length > 0, 'wp:session must return a caller id')
    assert(typeof body.output?.expiresAt === 'string' && !Number.isNaN(Date.parse(body.output.expiresAt)), 'wp:session must return an ISO expiresAt')
    token = body.output.token
  })

  await run('unknown-action-error', async () => {
    const world = requireDiscovery(discovery)
    let name = 'worldkit:conformance-unknown'
    while (world.actions?.includes(name)) name += '-x'
    const response = await postAction(fetch, world, name, { input: {} }, token)
    assert(response.status === 404, `Unknown action must return 404, received ${response.status}`)
    await assertProtocolError(response, 'unknown action')
  })

  await run('action-request-validation', async () => {
    const world = requireDiscovery(discovery)
    const action = worldActions(world)[0]
    assert(action !== undefined, 'No world action to probe')
    for (const [label, body] of [['an array body', []], ['a non-object input', { input: 'x' }]] as const) {
      const response = await postAction(fetch, world, action, body, token)
      assert(response.status === 400, `${action} with ${label} must return 400, received ${response.status}`)
      await assertProtocolError(response, `${action} with ${label}`)
    }
  })

  await run('action-requires-session', async () => {
    const world = requireDiscovery(discovery)
    const action = worldActions(world)[0]
    assert(action !== undefined, 'No world action to probe')
    const response = await postAction(fetch, world, action, { input: {} }, 'worldkit-conformance-invalid-token')
    // An action may allow anonymous callers; then it must not treat a bad token as a crash.
    assert(response.status === 401 || (response.status >= 200 && response.status < 500), `${action} with an invalid token returned ${response.status}`)
    if (response.status === 401) await assertProtocolError(response, `${action} with an invalid token`)
  })

  await run('events-stream', async () => {
    const world = requireDiscovery(discovery)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), eventsTimeoutMs)
    try {
      const response = await fetch(new URL(world.endpoints.events!), { headers: { accept: 'text/event-stream' }, signal: controller.signal })
      assert(response.status === 200, `Events endpoint returned HTTP ${response.status}`)
      assert((response.headers.get('content-type') ?? '').startsWith('text/event-stream'), 'Events endpoint must answer text/event-stream')
      assert(response.headers.get('cache-control')?.includes('no-store') === true, 'Events endpoint must send Cache-Control: no-store')
      const reader = response.body?.getReader()
      assert(reader !== undefined, 'Events endpoint returned no body')
      // Not every runtime cancels a body when its request is aborted, so cancel the reader too.
      const onAbort = () => {
        reader.cancel().catch(() => undefined)
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      const first = await reader.read()
      controller.signal.removeEventListener('abort', onAbort)
      if (controller.signal.aborted) throw new Error('timed out')
      assert(!first.done && first.value.byteLength > 0, 'Events endpoint closed without sending anything')
      await reader.cancel().catch(() => undefined)
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Events endpoint sent nothing within ${eventsTimeoutMs} ms`)
      throw error
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  })

  return { level: 2, passed: checks.every((check) => check.passed), world: worldUrl.href, checks }
}

export async function assertLevel2Conformance(
  target: Level2ConformanceTarget,
  options: Level2ConformanceOptions = {},
): Promise<Level2ConformanceReport> {
  const report = await runLevel2Conformance(target, options)
  if (!report.passed) throw new Level2ConformanceError(report)
  return report
}

function worldActions(discovery: WorldDiscoveryDocument): string[] {
  return (discovery.actions ?? []).filter((action) => !BUILT_IN_ACTIONS.has(action))
}

function postAction(fetch: Fetch, discovery: WorldDiscoveryDocument, action: string, body: unknown, token?: string): Promise<Response> {
  const url = new URL(`${discovery.endpoints.api.replace(/\/+$/, '')}/actions/${encodeURIComponent(action)}`)
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

async function assertProtocolError(response: Response, label: string): Promise<void> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error(`${label} must return a JSON protocol error`)
  }
  const record = value as { code?: unknown; message?: unknown }
  assert(typeof record?.code === 'string' && record.code.length > 0, `${label} protocol error needs a code`)
  assert(typeof record.message === 'string' && record.message.length > 0, `${label} protocol error needs a message`)
}

function requireDiscovery(discovery: WorldDiscoveryDocument | undefined): WorldDiscoveryDocument {
  assert(discovery !== undefined, 'Level 2 discovery prerequisite failed')
  return discovery
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100
}
