import { describe, expect, it } from 'vitest'

import type { WorldDiscoveryDocument } from '@worlddevkit/spec'

import { WorldClient, WorldHttpError, type WorldStreamEvent } from './client.js'

const world: WorldDiscoveryDocument = {
  protocol: 'world/0.1',
  id: 'https://game.world',
  name: 'Game',
  endpoints: { api: 'https://game.world/api/world/v0', events: 'https://game.world/api/world/v0/events' },
  entityTypes: ['game:plot'],
  actions: ['wp:discover', 'wp:session', 'game:claim'],
  extensions: ['wp:level-2'],
}

const plot = {
  ref: { world: world.id, type: 'game:plot', id: 'p1' },
  version: 2,
  updatedAt: '2026-01-01T00:00:00.000Z',
  visibility: 'public',
  attributes: { owner: 'c_1' },
  relationships: [],
  capabilities: [],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('WorldClient Level 2', () => {
  it('starts sessions and sends actions with target, ifVersion and the bearer token', async () => {
    const seen: { url: string; body: unknown; auth: string | null }[] = []
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const body = await request.json()
      seen.push({ url: request.url, body, auth: request.headers.get('authorization') })
      if (request.url.endsWith('wp%3Asession')) return json({ output: { token: 'tok', caller: 'c_1', expiresAt: '2026-01-02T00:00:00.000Z' }, changed: [], removed: [] })
      return json({ output: { claimed: 'p1' }, changed: [plot], removed: [] })
    }
    const client = new WorldClient(world, { fetch })
    expect(client.isLevel2).toBe(true)

    const session = await client.startSession()
    expect(session).toEqual({ token: 'tok', caller: 'c_1', expiresAt: '2026-01-02T00:00:00.000Z' })

    const player = client.withAccessToken(session.token)
    const result = await player.invoke('game:claim', { note: 'mine' }, { target: { type: 'game:plot', id: 'p1' }, ifVersion: 1 })
    expect(result.output).toEqual({ claimed: 'p1' })
    expect(result.changed[0]?.version).toBe(2)
    expect(seen[1]).toEqual({
      url: 'https://game.world/api/world/v0/actions/game%3Aclaim',
      body: { input: { note: 'mine' }, target: { type: 'game:plot', id: 'p1' }, ifVersion: 1 },
      auth: 'Bearer tok',
    })
  })

  it('surfaces refusals with their code and details', async () => {
    const fetch = async () => json({ code: 'version_conflict', message: 'changed', details: { current: plot } }, 409)
    const error = await new WorldClient(world, { fetch }).invoke('game:claim', {}, { target: { type: 'game:plot', id: 'p1' }, ifVersion: 1 }).catch((caught) => caught)
    expect(error).toBeInstanceOf(WorldHttpError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('version_conflict')
    expect((error.details as { current: { version: number } }).current.version).toBe(2)
  })

  it('reads server-sent events, skips comments, and resumes after a drop', async () => {
    const encoder = new TextEncoder()
    const requests: (string | null)[] = []
    let connection = 0
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.headers.get('last-event-id'))
      connection += 1
      const chunks = connection === 1
        ? ['retry: 2000\n: connected\n\n', 'id: 1\nevent: entity.changed\ndata: {"entity":', '{"ref":{"id":"p1"}}}\n\n', 'id: 2\nevent: game:round\ndata: {"n":1}\n\n']
        : [': connected\n\n', 'id: 3\r\nevent: game:round\r\ndata: {"n":2}\r\n\r\n']
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
          if (connection === 1) controller.close()
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }

    const events: WorldStreamEvent[] = []
    const errors: unknown[] = []
    const subscription = new WorldClient(world, { fetch }).subscribe((event) => {
      events.push(event)
      if (events.length === 3) subscription.close()
    }, { onError: (error) => errors.push(error) })
    await subscription.closed

    expect(events).toEqual([
      { id: 1, event: 'entity.changed', data: { entity: { ref: { id: 'p1' } } } },
      { id: 2, event: 'game:round', data: { n: 1 } },
      { id: 3, event: 'game:round', data: { n: 2 } },
    ])
    expect(requests).toEqual([null, '2'])
    expect(errors).toHaveLength(1)
  })

  it('stops instead of reconnecting when the world refuses the stream', async () => {
    const fetch = async () => json({ code: 'not_found', message: 'nope' }, 404)
    const errors: unknown[] = []
    const subscription = new WorldClient(world, { fetch }).subscribe(() => {}, { onError: (error) => errors.push(error) })
    await subscription.closed
    expect(errors).toHaveLength(1)
    expect((errors[0] as WorldHttpError).status).toBe(404)
  })

  it('refuses to subscribe to a world without an events endpoint', () => {
    const levelOne = new WorldClient({ ...world, endpoints: { api: world.endpoints.api }, extensions: [] })
    expect(levelOne.isLevel2).toBe(false)
    expect(() => levelOne.subscribe(() => {})).toThrow(/events endpoint/)
  })
})
