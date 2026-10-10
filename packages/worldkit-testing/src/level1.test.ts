import { describe, expect, it } from 'vitest'

import type { EntityEnvelope, WorldDiscoveryDocument } from '@worlddevkit/spec'

import { Level1ConformanceError, assertLevel1Conformance, runLevel1Conformance } from './level1.js'

const world: WorldDiscoveryDocument = {
  protocol: 'world/0.1',
  id: 'https://fixture.world',
  name: 'Fixture World',
  endpoints: { api: 'https://fixture.world/api/world/v0' },
  entityTypes: ['wp:place', 'wp:event'],
  actions: ['wp:discover'],
}

const fixtureEntities: EntityEnvelope[] = [
  entity('wp:place', 'place-1', 'Library'),
  entity('wp:place', 'place-2', 'Park'),
  entity('wp:place', 'place-3', 'Cafe'),
  entity('wp:event', 'event-1', 'Market'),
]

interface FixtureOptions {
  loopPagination?: boolean
  discoverEntity?: EntityEnvelope
}

function entity(type: string, id: string, name: string): EntityEnvelope {
  return {
    ref: { world: world.id, type, id },
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'public',
    attributes: { name },
    relationships: [],
    capabilities: ['wp:view'],
  }
}

function fixtureFetch(options: FixtureOptions = {}): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const headers = corsHeaders(request)

    if (request.method === 'GET' && url.pathname === '/.well-known/world.json') return json(world, 200, headers)
    if (request.method === 'GET' && url.pathname === '/api/world/v0') return json(world, 200, headers)

    const segments = url.pathname.replace('/api/world/v0/', '').split('/').map(decodeURIComponent)
    if (request.method === 'GET' && segments[0] === 'entities' && segments.length === 2) {
      const type = segments[1] ?? ''
      if (!world.entityTypes.includes(type)) return protocolError(404, 'unknown_entity_type', headers)
      const matching = fixtureEntities.filter((item) => item.ref.type === type)
      const offset = Number(url.searchParams.get('cursor') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 20)
      const page = matching.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      const nextCursor = options.loopPagination
        ? String(offset + 1)
        : nextOffset < matching.length ? String(nextOffset) : null
      return json({ entities: page, nextCursor }, 200, headers)
    }

    if (request.method === 'GET' && segments[0] === 'entities' && segments.length === 3) {
      const found = fixtureEntities.find((item) => item.ref.type === segments[1] && item.ref.id === segments[2])
      return found ? json(found, 200, headers) : protocolError(404, 'entity_not_found', headers)
    }

    if (request.method === 'POST' && segments[0] === 'actions' && segments[1] === 'wp:discover' && segments.length === 2) {
      const body: unknown = await request.json()
      if (!isRecord(body) || !isRecord(body.input)) return protocolError(400, 'invalid_input', headers)
      const limit = typeof body.input.limit === 'number' ? body.input.limit : 20
      const entities = options.discoverEntity ? [options.discoverEntity] : fixtureEntities.slice(0, limit)
      return json({ output: { entities, nextCursor: null } }, 200, headers)
    }

    return protocolError(404, 'not_found', headers)
  }
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (request.headers.has('origin')) headers.set('access-control-allow-origin', '*')
  return headers
}

function json(value: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(value), { status, headers })
}

function protocolError(status: number, code: string, headers: Headers): Response {
  return json({ code, message: code.replaceAll('_', ' ') }, status, headers)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('Level 1 conformance runner', () => {
  it('passes a conforming in-memory Fetch target', async () => {
    const report = await assertLevel1Conformance(
      { world: world.id, fetch: fixtureFetch() },
      { pageSize: 2 },
    )

    expect(report.passed).toBe(true)
    expect(report.protocol).toBe('world/0.1')
    expect(report.checks).toHaveLength(8)
    expect(report.checks.every((check) => check.passed)).toBe(true)
  })

  it('reports an entity type returned without advertisement', async () => {
    const hidden = entity('wp:hidden', 'hidden-1', 'Hidden')
    const report = await runLevel1Conformance({
      world: world.id,
      fetch: fixtureFetch({ discoverEntity: hidden }),
    })

    expect(report.passed).toBe(false)
    expect(report.checks.find((check) => check.name === 'no-unadvertised-entity-types')).toMatchObject({
      passed: false,
      error: 'Response exposed unadvertised entity type: wp:hidden',
    })
  })

  it('bounds non-terminating pagination and exposes the report from the assertion error', async () => {
    await expect(assertLevel1Conformance(
      { world: world.id, fetch: fixtureFetch({ loopPagination: true }) },
      { maxPagesPerType: 3 },
    )).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Level1ConformanceError)
      const conformanceError = error as Level1ConformanceError
      expect(conformanceError.report.checks.find((check) => check.name === 'pagination-termination')).toMatchObject({
        passed: false,
      })
      return true
    })
  })
})
