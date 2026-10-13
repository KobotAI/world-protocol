import { describe, expect, it } from 'vitest'

import type { EntityEnvelope, WorldDiscoveryDocument } from '@worlddevkit/spec'

import { ActionError, createEventHub } from './level2.js'
import { defineWorld } from './world.js'

const base = 'https://plots.world'

function plotsWorld() {
  return defineWorld({
    url: base,
    name: 'Plots',
    entities: [
      { type: 'game:plot', id: 'p1', attributes: { name: 'Plot 1', owner: null }, capabilities: ['game:claim'] },
      { type: 'game:plot', id: 'p2', attributes: { name: 'Plot 2', owner: null }, capabilities: [] },
      { type: 'game:vault', id: 'v1', attributes: { name: 'Hidden' }, visibility: 'private', capabilities: ['game:claim'] },
    ],
    entityTypes: ['game:player'],
    events: ['game:announcement'],
    actions: {
      'game:join': {
        handler({ input, caller, world }) {
          const name = typeof input.name === 'string' ? input.name.trim() : ''
          if (!name) throw new ActionError('invalid_name', 'Pick a name')
          world.create({ type: 'game:player', id: caller!.id, attributes: { name, score: 0 } })
          world.emit('game:announcement', { text: `${name} joined` })
          return { player: caller!.id }
        },
      },
      'game:claim': {
        targetTypes: ['game:plot', 'game:vault'],
        async handler({ target, caller, world }) {
          await new Promise((resolve) => setTimeout(resolve, 5))
          const plot = world.get(target!.ref.type, target!.ref.id)!
          if (plot.attributes.owner) throw new ActionError('already_claimed', 'Someone already claimed this plot')
          world.update(plot.ref.type, plot.ref.id, { attributes: { owner: caller!.id }, capabilities: [] })
          return { claimed: plot.ref.id }
        },
      },
      'game:ping': { requiresCaller: false, handler: () => 'pong' },
    },
  })
}

async function call(world: ReturnType<typeof plotsWorld>, name: string, body: unknown, token?: string) {
  const response = await world.fetch(`${base}/api/world/v0/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, any>, headers: response.headers }
}

async function session(world: ReturnType<typeof plotsWorld>) {
  return (await call(world, 'wp:session', {})).body.output.token as string
}

describe('Level 2 discovery', () => {
  it('advertises actions, events and the level-2 extension', () => {
    const { discovery } = plotsWorld()
    expect(discovery.actions).toEqual(['wp:discover', 'wp:session', 'game:join', 'game:claim', 'game:ping'])
    expect(discovery.endpoints.events).toBe(`${base}/api/world/v0/events`)
    expect(discovery.events).toEqual(['entity.changed', 'entity.removed', 'game:announcement'])
    expect(discovery.extensions).toEqual(['wp:level-2'])
    expect(discovery.entityTypes).toEqual(['game:player', 'game:plot', 'game:vault'])
  })

  it('stays a plain Level 1 world without actions', () => {
    const { discovery } = defineWorld({ url: base, name: 'Read only', entities: [{ type: 'wp:place', id: 'a', attributes: {} }] })
    expect(discovery.actions).toEqual(['wp:discover'])
    expect(discovery.endpoints.events).toBeUndefined()
    expect(discovery.extensions).toBeUndefined()
  })

  it('rejects un-namespaced and built-in action names', () => {
    expect(() => defineWorld({ url: base, name: 'X', entities: [{ type: 'a:b', id: '1', attributes: {} }], actions: { claim: { handler: () => null } } }))
      .toThrow(/namespaced/)
    expect(() => defineWorld({ url: base, name: 'X', entities: [{ type: 'a:b', id: '1', attributes: {} }], actions: { 'wp:session': { handler: () => null } } }))
      .toThrow(/built in/)
  })
})

describe('Level 2 actions', () => {
  it('issues sessions and requires them by default', async () => {
    const world = plotsWorld()
    const anonymous = await call(world, 'game:join', { input: { name: 'Ada' } })
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.code).toBe('unauthenticated')
    expect(anonymous.headers.get('cache-control')).toBe('no-store')

    const issued = await call(world, 'wp:session', {})
    expect(issued.status).toBe(200)
    expect(issued.body.output.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(issued.body.output.caller).toMatch(/^c_/)

    const joined = await call(world, 'game:join', { input: { name: 'Ada' } }, issued.body.output.token)
    expect(joined.status).toBe(200)
    expect(joined.body.output).toEqual({ player: issued.body.output.caller })
    expect(joined.body.changed).toHaveLength(1)
    expect(joined.body.changed[0]).toMatchObject({ ref: { world: base, type: 'game:player', id: issued.body.output.caller }, version: 1, attributes: { name: 'Ada', score: 0 } })
  })

  it('allows anonymous actions that opt out of sessions', async () => {
    const result = await call(plotsWorld(), 'game:ping', {})
    expect(result).toMatchObject({ status: 200, body: { output: 'pong', changed: [], removed: [] } })
  })

  it('answers protocol errors for bad requests', async () => {
    const world = plotsWorld()
    const token = await session(world)
    expect((await call(world, 'game:nope', {}, token)).body.code).toBe('unknown_action')
    expect((await call(world, 'game:join', { input: 'x' }, token)).body.code).toBe('invalid_input')
    expect((await call(world, 'game:join', [], token)).body.code).toBe('invalid_json')
    expect((await call(world, 'game:claim', {}, token)).body.code).toBe('invalid_target')
    expect((await call(world, 'game:claim', { target: { type: 'game:plot', id: 'zz' } }, token)).status).toBe(404)
    expect((await call(world, 'game:claim', { target: { type: 'game:plot', id: 'p1' }, ifVersion: -1 }, token)).body.code).toBe('invalid_if_version')
    const refused = await call(world, 'game:join', { input: { name: ' ' } }, token)
    expect(refused).toMatchObject({ status: 422, body: { code: 'invalid_name', message: 'Pick a name' } })
  })

  it('enforces the target entity capabilities and hides private targets', async () => {
    const world = plotsWorld()
    const token = await session(world)
    const forbidden = await call(world, 'game:claim', { target: { type: 'game:plot', id: 'p2' } }, token)
    expect(forbidden).toMatchObject({ status: 403, body: { code: 'not_allowed' } })
    const hidden = await call(world, 'game:claim', { target: { type: 'game:vault', id: 'v1' } }, token)
    expect(hidden).toMatchObject({ status: 404, body: { code: 'entity_not_found' } })
  })

  it('updates versions and returns the changed entity', async () => {
    const world = plotsWorld()
    const token = await session(world)
    const result = await call(world, 'game:claim', { target: { type: 'game:plot', id: 'p1' }, ifVersion: 1 }, token)
    expect(result.status).toBe(200)
    expect(result.body.changed[0]).toMatchObject({ version: 2, attributes: { name: 'Plot 1' }, capabilities: [] })
    const read = await (await world.fetch(`${base}/api/world/v0/entities/game%3Aplot/p1`)).json() as EntityEnvelope
    expect(read.version).toBe(2)
    expect(world.read.get('game:plot', 'p1')?.attributes.owner).toBeTruthy()
  })

  it('refuses a stale ifVersion with the current entity', async () => {
    const world = plotsWorld()
    await world.change((store) => store.update('game:plot', 'p1', { attributes: { name: 'Renamed' } }))
    const token = await session(world)
    const stale = await call(world, 'game:claim', { target: { type: 'game:plot', id: 'p1' }, ifVersion: 1 }, token)
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('version_conflict')
    expect(stale.body.details.current).toMatchObject({ version: 2, attributes: { name: 'Renamed' } })
  })

  it('lets exactly one of two simultaneous claims win', async () => {
    const world = plotsWorld()
    const [a, b] = await Promise.all([session(world), session(world)])
    const target = { type: 'game:plot', id: 'p1' }
    const results = await Promise.all([
      call(world, 'game:claim', { target, ifVersion: 1 }, a),
      call(world, 'game:claim', { target, ifVersion: 1 }, b),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  })

  it('serialises check-then-write handlers even without ifVersion', async () => {
    const world = plotsWorld()
    const tokens = await Promise.all([session(world), session(world), session(world)])
    const results = await Promise.all(tokens.map((token) => call(world, 'game:claim', { target: { type: 'game:plot', id: 'p1' } }, token)))
    const statuses = results.map((result) => result.status).sort()
    // The first claim wins; the plot then drops its capability, so the others are refused.
    expect(statuses).toEqual([200, 403, 403])
  })

  it('refuses entity types the world does not advertise', async () => {
    const world = defineWorld({
      url: base,
      name: 'X',
      entities: [{ type: 'game:plot', id: 'p', attributes: {} }],
      actions: { 'game:spawn': { requiresCaller: false, handler: ({ world }) => { world.create({ type: 'game:ghost', id: 'g', attributes: {} }) } } },
    })
    const result = await call(world as ReturnType<typeof plotsWorld>, 'game:spawn', {})
    expect(result.status).toBe(503)
  })

  it('rate-limits actions per session', async () => {
    const world = defineWorld({
      url: base,
      name: 'X',
      entities: [{ type: 'game:plot', id: 'p', attributes: {} }],
      actions: { 'game:tap': { handler: () => null } },
      actionRateLimiter: { consume: (key) => ({ allowed: !key.startsWith('action:c_'), retryAfterSeconds: 3 }) },
    })
    const token = (await call(world as ReturnType<typeof plotsWorld>, 'wp:session', {})).body.output.token
    const limited = await call(world as ReturnType<typeof plotsWorld>, 'game:tap', {}, token)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('3')
  })
})

describe('Level 2 session limits', () => {
  it('limits new sessions per client address, separately from actions', async () => {
    const world = plotsWorld()
    const burst = await Promise.all(Array.from({ length: 12 }, () => world.fetch(`${base}/api/world/v0/actions/wp%3Asession`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body: '{}',
    })))
    const statuses = burst.map((response) => response.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(10)
    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
    const other = await world.fetch(`${base}/api/world/v0/actions/wp%3Asession`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.2' }, body: '{}',
    })
    expect(other.status).toBe(200)
  })
})

describe('Level 2 events', () => {
  async function readEvents(response: Response, count: number) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const events: { id?: string; event?: string; data?: any }[] = []
    while (events.length < count) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = text.indexOf('\n\n')) >= 0) {
        const block = text.slice(0, boundary)
        text = text.slice(boundary + 2)
        const entry: { id?: string; event?: string; data?: any } = {}
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) entry.id = line.slice(4)
          if (line.startsWith('event: ')) entry.event = line.slice(7)
          if (line.startsWith('data: ')) entry.data = JSON.parse(line.slice(6))
        }
        if (entry.event) events.push(entry)
      }
    }
    await reader.cancel()
    return events
  }

  it('streams entity changes and world events to subscribers', async () => {
    const world = plotsWorld()
    const controller = new AbortController()
    const stream = await world.fetch(`${base}/api/world/v0/events`, { signal: controller.signal })
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toMatch(/^text\/event-stream/)
    expect(stream.headers.get('cache-control')).toBe('no-store')

    const token = await session(world)
    const pending = readEvents(stream, 3)
    await call(world, 'game:join', { input: { name: 'Ada' } }, token)
    await call(world, 'game:claim', { target: { type: 'game:plot', id: 'p1' } }, token)
    const events = await pending
    controller.abort()

    expect(events.map((event) => event.event)).toEqual(['entity.changed', 'game:announcement', 'entity.changed'])
    expect(events[0]!.data.entity.ref.type).toBe('game:player')
    expect(events[1]!.data).toEqual({ text: 'Ada joined' })
    expect(events[2]!.data.entity).toMatchObject({ ref: { id: 'p1' }, version: 2 })
    expect(events.map((event) => Number(event.id))).toEqual([1, 2, 3])
  })

  it('resumes from Last-Event-ID', async () => {
    const world = plotsWorld()
    const token = await session(world)
    await call(world, 'game:join', { input: { name: 'Ada' } }, token)
    await call(world, 'game:claim', { target: { type: 'game:plot', id: 'p1' } }, token)
    const controller = new AbortController()
    const stream = await world.fetch(`${base}/api/world/v0/events`, { headers: { 'last-event-id': '2' }, signal: controller.signal })
    const [missed] = await readEvents(stream, 1)
    controller.abort()
    expect(missed).toMatchObject({ id: '3', event: 'entity.changed' })
  })

  it('never publishes non-public entities', async () => {
    const world = plotsWorld()
    const seen: string[] = []
    const controller = new AbortController()
    const stream = await world.fetch(`${base}/api/world/v0/events`, { signal: controller.signal })
    const pending = readEvents(stream, 1).then((events) => events.forEach((event) => seen.push(`${event.event}:${event.data?.entity?.ref?.id ?? ''}`)))
    await world.change((store) => store.update('game:vault', 'v1', { attributes: { name: 'Still hidden' } }))
    await world.change((store) => store.update('game:plot', 'p2', { attributes: { name: 'Visible' } }))
    await pending
    controller.abort()
    expect(seen).toEqual(['entity.changed:p2'])
  })

  it('tells a client whose history expired to reset', () => {
    const hub = createEventHub({ history: 2 })
    for (let i = 0; i < 5; i += 1) hub.publish('tick', i)
    expect(hub.since(4)?.map((event) => event.data)).toEqual([4])
    expect(hub.since(3)?.map((event) => event.data)).toEqual([3, 4])
    expect(hub.since(1)).toBeNull()
  })
})

describe('Level 2 keeps Level 1 intact', () => {
  it('serves the discovery document with the Level 2 fields', async () => {
    const response = await plotsWorld().fetch(`${base}/.well-known/world.json`)
    const discovery = await response.json() as WorldDiscoveryDocument
    expect(discovery.extensions).toContain('wp:level-2')
  })
})
