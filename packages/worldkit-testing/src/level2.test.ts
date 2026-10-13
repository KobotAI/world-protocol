import { describe, expect, it } from 'vitest'

import { WorldClient } from '@worlddevkit/client'
import { ActionError, defineWorld } from '@worlddevkit/server'

import { runLevel1Conformance } from './level1.js'
import { Level2ConformanceError, assertLevel2Conformance, runLevel2Conformance } from './level2.js'

function counterWorld() {
  return defineWorld({
    url: 'https://counter.world',
    name: 'Counter',
    entities: [{ type: 'game:counter', id: 'c', attributes: { name: 'Counter', value: 0 }, capabilities: ['game:bump'] }],
    events: ['game:milestone'],
    actions: {
      'game:bump': {
        targetTypes: ['game:counter'],
        handler({ target, world, ifVersion }) {
          const value = Number(target!.attributes.value) + 1
          const updated = world.update('game:counter', 'c', { attributes: { value } }, ifVersion === null ? {} : { ifVersion })
          if (value % 2 === 0) world.emit('game:milestone', { value })
          return { value: updated.attributes.value as number }
        },
      },
      'game:fail': { handler: () => { throw new ActionError('nope', 'Never works') } },
    },
  })
}

describe('Level 2 conformance', () => {
  it('passes a defineWorld world on both levels', async () => {
    const world = counterWorld()
    const level1 = await runLevel1Conformance({ world: world.discovery.id, fetch: world.fetch })
    expect(level1.checks.filter((check) => !check.passed)).toEqual([])
    const level2 = await assertLevel2Conformance({ world: world.discovery.id, fetch: world.fetch })
    expect(level2.checks.map((check) => check.name)).toEqual([
      'level2-discovery', 'session-issued', 'unknown-action-error', 'action-request-validation', 'action-requires-session', 'events-stream',
    ])
  })

  it('fails a Level 1 world', async () => {
    const world = defineWorld({ url: 'https://plain.world', name: 'Plain', entities: [{ type: 'wp:place', id: 'a', attributes: {} }] })
    const error = await assertLevel2Conformance({ world: world.discovery.id, fetch: world.fetch }).catch((caught) => caught)
    expect(error).toBeInstanceOf(Level2ConformanceError)
    expect((error as Level2ConformanceError).report.checks[0]).toMatchObject({ name: 'level2-discovery', passed: false })
  })

  it('reports an events endpoint that never answers', async () => {
    const world = counterWorld()
    const fetch = (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/events')) {
        return Promise.resolve(new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } }))
      }
      return world.fetch(request)
    }
    const report = await runLevel2Conformance({ world: world.discovery.id, fetch }, { eventsTimeoutMs: 200 })
    expect(report.checks.find((check) => check.name === 'events-stream')).toMatchObject({ passed: false, error: 'Events endpoint sent nothing within 200 ms' })
  })
})

describe('client and server together', () => {
  it('plays: two players race, one wins, both see the events', async () => {
    const world = counterWorld()
    const client = new WorldClient(world.discovery, { fetch: world.fetch })
    const [alice, bob] = await Promise.all([client.startSession(), client.startSession()])
    const asAlice = client.withAccessToken(alice.token)
    const asBob = client.withAccessToken(bob.token)

    const events: string[] = []
    const subscription = client.subscribe((event) => {
      events.push(event.event)
      if (events.length === 3) subscription.close()
    })

    const target = { type: 'game:counter', id: 'c' }
    const results = await Promise.allSettled([
      asAlice.invoke('game:bump', {}, { target, ifVersion: 1 }),
      asBob.invoke('game:bump', {}, { target, ifVersion: 1 }),
    ])
    const winners = results.filter((result) => result.status === 'fulfilled')
    const losers = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[]
    expect(winners).toHaveLength(1)
    expect(losers[0]!.reason.code).toBe('version_conflict')
    expect(losers[0]!.reason.details.current.version).toBe(2)

    await asBob.invoke('game:bump', {}, { target, ifVersion: 2 })
    await subscription.closed
    expect(events).toEqual(['entity.changed', 'entity.changed', 'game:milestone'])

    const refused = await asAlice.invoke('game:fail').catch((caught) => caught)
    expect(refused).toMatchObject({ status: 422, code: 'nope', message: 'Never works' })
  })
})
