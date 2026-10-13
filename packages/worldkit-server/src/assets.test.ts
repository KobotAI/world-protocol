import { describe, expect, it } from 'vitest'

import type { EntityEnvelope, PaginatedEntityCollection } from '@worlddevkit/spec'

import { defineAsset, placementId, type Fetch } from './assets.js'
import { defineWorld } from './world.js'

const SHOP = 'https://shop.example'
const GAME = 'https://game.example'
const ADMIN = 'admin-token-0123456789abcdef'

function asset(id: string, name: string, extra: Partial<Parameters<typeof defineAsset>[0]> = {}) {
  return defineAsset({
    id,
    name,
    description: `${name} from the shop`,
    image: { url: `${SHOP}/img/${id}.png`, alt: `Photo of ${name}`, width: 512, height: 512 },
    web: `${SHOP}/p/${id}`,
    price: { amount: 1_800_000, currency: 'NGN' },
    ...extra,
  })
}

function setup(options: { accept?: 'manual' | 'auto'; max?: number; hosts?: 'any' | string[]; delayMs?: number } = {}) {
  const shop = defineWorld({
    url: SHOP,
    name: 'Yaba Shop',
    entities: [
      asset('stove', 'Eleven Gas Stove', { hosts: options.hosts ?? 'any' }),
      asset('fan', 'Standing Fan'),
      asset('kettle', 'Boscon Kettle'),
      { type: 'wp:product', id: 'not-an-asset', attributes: { name: 'Plain product' } },
    ],
    actions: { 'shop:noop': { requiresCaller: false, handler: () => null } },
  })
  const worlds: Record<string, { fetch: Fetch }> = { [SHOP]: shop }
  const fetch: Fetch = async (input, init) => {
    const request = new Request(input as string | URL | Request, init)
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    const target = worlds[new URL(request.url).origin]
    if (!target) throw new TypeError('fetch failed')
    return target.fetch(request)
  }
  const game = defineWorld({
    url: GAME,
    name: 'Market Game',
    entities: [{ type: 'game:stall', id: 's1', attributes: { name: 'Stall' } }],
    adminToken: ADMIN,
    placements: { max: options.max ?? 2, accept: options.accept ?? 'manual', fetch },
    actions: { 'game:ping': { requiresCaller: false, handler: () => 'pong' } },
  })
  worlds[GAME] = game
  return { shop, game }
}

async function act(world: ReturnType<typeof defineWorld>, name: string, input: unknown, token?: string) {
  const response = await world.fetch(`${world.discovery.id}/api/world/v0/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ input }),
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

async function player(world: ReturnType<typeof defineWorld>) {
  return (await act(world, 'wp:session', {})).body.output.token as string
}

async function publicPlacements(world: ReturnType<typeof defineWorld>) {
  const page = await (await world.fetch(`${world.discovery.id}/api/world/v0/entities/wp%3Aplacement`)).json() as PaginatedEntityCollection
  return page.entities
}

describe('publishing assets', () => {
  it('advertises wp:assets and validates assets at startup', () => {
    const { shop } = setup()
    expect(shop.discovery.extensions).toContain('wp:assets')
    expect(() => defineAsset({ id: 'x', name: 'X', image: { url: 'http://cdn.example/x.png', alt: 'x' }, web: `${SHOP}/x` })).toThrow(/https/)
    expect(() => defineAsset({ id: 'x', name: 'X', image: { url: `${SHOP}/x.png`, alt: '' }, web: `${SHOP}/x` })).toThrow(/alt text/)
    expect(() => defineAsset({ id: 'x', name: 'X', image: { url: `${SHOP}/x.png`, alt: 'x' }, web: `${SHOP}/x`, model: { url: `${SHOP}/x.glb`, format: 'glb', bytes: 50_000_000 } })).toThrow(/model bytes/)
    expect(() => defineAsset({ id: 'x', name: 'X', image: { url: 'https://10.0.0.5/x.png', alt: 'x' }, web: `${SHOP}/x` })).toThrow(/public address/)
    expect(() => defineWorld({ url: SHOP, name: 'Bad', entities: [{ type: 'wp:asset', id: 'a', attributes: { name: 'A' } }] })).toThrow(/needs an image/)
  })

  it('lets local development worlds use localhost links', () => {
    expect(() => defineWorld({
      url: 'http://localhost:8787',
      name: 'Dev shop',
      entities: [{ type: 'wp:asset', id: 'a', attributes: { name: 'A', image: { url: 'http://localhost:8787/a.png', alt: 'A' } }, links: { web: 'http://localhost:8787/a' } }],
    })).not.toThrow()
  })
})

describe('hosting placements', () => {
  it('needs an admin token and advertises the placement actions', () => {
    expect(() => defineWorld({ url: GAME, name: 'G', entities: [{ type: 'a:b', id: '1', attributes: {} }], placements: {} })).toThrow(/adminToken/)
    const { game } = setup()
    expect(game.discovery.extensions).toEqual(['wp:level-2', 'wp:placements'])
    expect(game.discovery.actions).toEqual(['wp:discover', 'wp:session', 'game:ping', 'wp:offer', 'wp:accept', 'wp:remove', 'wp:placements'])
    expect(game.discovery.entityTypes).toContain('wp:placement')
  })

  it('keeps offers private until the owner accepts them', async () => {
    const { game } = setup()
    const token = await player(game)
    const offer = await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, token)
    expect(offer).toMatchObject({ status: 200, body: { output: { status: 'offered' } } })
    const id = offer.body.output.placement as string
    expect(id).toBe(placementId({ world: SHOP, type: 'wp:asset', id: 'stove' }))
    expect(await publicPlacements(game)).toEqual([])

    expect((await act(game, 'wp:accept', { placement: id }, token)).body.code).toBe('admin_only')
    expect((await act(game, 'wp:accept', { placement: id })).status).toBe(401)

    const listed = await act(game, 'wp:placements', {}, ADMIN)
    expect(listed.body.output.placements).toMatchObject([{ id, status: 'offered', name: 'Eleven Gas Stove', from: 'Yaba Shop' }])

    const accepted = await act(game, 'wp:accept', { placement: id, slot: 'stall-1' }, ADMIN)
    expect(accepted.body.output).toEqual({ placement: id, status: 'placed', slot: 'stall-1' })
    const [placement] = await publicPlacements(game)
    expect(placement).toMatchObject({
      ref: { world: GAME, type: 'wp:placement', id },
      visibility: 'public',
      attributes: {
        name: 'Eleven Gas Stove',
        status: 'placed',
        slot: 'stall-1',
        asset: { name: 'Eleven Gas Stove', image: { url: `${SHOP}/img/stove.png`, alt: 'Photo of Eleven Gas Stove' }, web: `${SHOP}/p/stove`, price: { amount: 1_800_000, currency: 'NGN' }, model: null },
        source: { world: SHOP, worldName: 'Yaba Shop', id: 'stove', version: 1 },
      },
      relationships: [{ rel: 'shows', target: { world: SHOP, type: 'wp:asset', id: 'stove' } }],
      links: { web: `${SHOP}/p/stove` },
      sponsorship: { sponsor: { name: 'Yaba Shop' }, label: 'presented_by' },
    })
  })

  it('refuses duplicates, a full host, other types and unknown assets', async () => {
    const { game } = setup({ max: 1 })
    const token = await player(game)
    const first = await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, token)
    expect((await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, token)).body.code).toBe('already_offered')
    const second = await act(game, 'wp:offer', { asset: { world: SHOP, id: 'fan' } }, token)
    await act(game, 'wp:accept', { placement: first.body.output.placement }, ADMIN)
    expect((await act(game, 'wp:accept', { placement: second.body.output.placement }, ADMIN)).body.code).toBe('host_full')
    expect((await act(game, 'wp:offer', { asset: { world: SHOP, id: 'not-an-asset' } }, token)).body.code).toBe('asset_not_found')
    expect((await act(game, 'wp:offer', { asset: { world: SHOP, id: 'nope' } }, token)).body.code).toBe('asset_not_found')
    expect((await act(game, 'wp:offer', { asset: { world: GAME, id: 'x' } }, token)).body.code).toBe('same_world')
    expect((await act(game, 'wp:remove', { placement: first.body.output.placement }, ADMIN)).status).toBe(200)
    expect(await publicPlacements(game)).toEqual([])
  })

  it('respects the asset owner’s choice of hosts', async () => {
    const { game } = setup({ hosts: ['https://someone-else.example'] })
    const token = await player(game)
    expect((await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, token)).body).toMatchObject({ code: 'host_not_allowed' })
  })

  it('never fetches from private networks or plain http', async () => {
    const { game } = setup()
    const token = await player(game)
    for (const world of ['https://10.0.0.1', 'https://192.168.1.10', 'https://localhost', 'http://shop.example', 'https://intranet', 'https://user:pw@shop.example']) {
      const result = await act(game, 'wp:offer', { asset: { world, id: 'stove' } }, token)
      expect(result.status, world).toBeGreaterThanOrEqual(400)
      expect(['invalid_world', 'world_not_allowed'], world).toContain(result.body.code)
    }
  })

  it('places offers at once with auto accept, up to the limit', async () => {
    const { game } = setup({ accept: 'auto', max: 2 })
    const token = await player(game)
    for (const id of ['stove', 'fan', 'kettle']) await act(game, 'wp:offer', { asset: { world: SHOP, id } }, token)
    const shown = await publicPlacements(game)
    expect(shown.map((entity) => entity.attributes.name)).toEqual(['Eleven Gas Stove', 'Standing Fan'])
    const all = await act(game, 'wp:placements', {}, ADMIN)
    expect(all.body.output.placements.map((p: { status: string }) => p.status)).toEqual(['placed', 'placed', 'offered'])
  })

  it('syncs price changes and drops withdrawn assets', async () => {
    const { shop, game } = setup({ accept: 'auto' })
    const token = await player(game)
    await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, token)
    await act(game, 'wp:offer', { asset: { world: SHOP, id: 'fan' } }, token)

    await shop.change((store) => store.update('wp:asset', 'stove', { attributes: { price: { amount: 1_500_000, currency: 'NGN' } } }))
    await shop.change((store) => store.remove('wp:asset', 'fan'))
    const report = await game.placements!.sync()
    expect(report).toEqual({ checked: 2, updated: 1, removed: 1, failed: 0 })

    const shown = await publicPlacements(game)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.attributes).toMatchObject({ asset: { price: { amount: 1_500_000 } }, source: { version: 2 } })
    expect(shown[0]!.version).toBe(2)
  })

  it('keeps placements when the source is only temporarily unreachable', async () => {
    const { game } = setup({ accept: 'auto' })
    await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, await player(game))
    const offline = defineWorld({
      url: GAME,
      name: 'Offline host',
      entities: [{ type: 'game:stall', id: 's1', attributes: {} }],
      adminToken: ADMIN,
      placements: { accept: 'auto', fetch: async () => { throw new TypeError('fetch failed') } },
    })
    expect((await act(offline, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, await player(offline))).body.code).toBe('world_unreachable')
    const report = await game.placements!.sync()
    expect(report.failed).toBe(0)
  })

  it('follows a live source and updates within a moment', async () => {
    const { shop, game } = setup({ accept: 'auto' })
    await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, await player(game))
    const stop = game.placements!.watchSources(60_000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await shop.change((store) => store.update('wp:asset', 'stove', { attributes: { name: 'Eleven Gas Stove (sale)' } }))
    let name = ''
    for (let i = 0; i < 40 && name !== 'Eleven Gas Stove (sale)'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      name = String(game.read.get('wp:placement', placementId({ world: SHOP, type: 'wp:asset', id: 'stove' }))?.attributes.name)
    }
    stop()
    expect(name).toBe('Eleven Gas Stove (sale)')
  })

  it('fetches offers outside the queue, so slow worlds never delay players', async () => {
    const { game } = setup({ delayMs: 300 })
    const token = await player(game)
    const started = Date.now()
    const offer = act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, token)
    const ping = await act(game, 'game:ping', {})
    expect(ping.body.output).toBe('pong')
    expect(Date.now() - started).toBeLessThan(150)
    expect((await offer).status).toBe(200)
  })

  it('keeps hosting worlds conformant', async () => {
    const { game } = setup({ accept: 'auto' })
    await act(game, 'wp:offer', { asset: { world: SHOP, id: 'stove' } }, await player(game))
    const shown = await publicPlacements(game) as EntityEnvelope[]
    expect(shown[0]!.ref.world).toBe(GAME)
  })
})
