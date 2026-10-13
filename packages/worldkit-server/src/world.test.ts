import { describe, expect, it } from 'vitest'

import type { EntityEnvelope, PaginatedEntityCollection, WorldDiscoveryDocument } from '@worlddevkit/spec'

import { defineWorld, type WorldEntityInput } from './world.js'

const entities: WorldEntityInput[] = [
  { type: 'wp:place', id: 'garden', attributes: { name: 'Central Garden', category: 'park' }, relationships: [{ rel: 'near', target: { type: 'wp:place', id: 'library' } }] },
  { type: 'wp:place', id: 'library', attributes: { name: 'North Library', category: 'library' }, updatedAt: '2026-02-01T00:00:00.000Z', version: 3 },
  { type: 'wp:event', id: 'reading', attributes: { name: 'Poetry Reading' }, relationships: [{ rel: 'at', target: { type: 'wp:place', id: 'library' } }] },
  { type: 'wp:place', id: 'vault', attributes: { name: 'Staff Vault' }, visibility: 'private' },
]

function world() {
  return defineWorld({ url: 'https://example.world/', name: 'Example', description: 'A test world', entities })
}

describe('defineWorld', () => {
  it('derives discovery from the entities', () => {
    expect(world().discovery).toEqual({
      protocol: 'world/0.1',
      id: 'https://example.world',
      name: 'Example',
      description: 'A test world',
      endpoints: { api: 'https://example.world/api/world/v0' },
      entityTypes: ['wp:place', 'wp:event'],
      actions: ['wp:discover'],
    })
  })

  it('stamps ref.world and fills defaults', () => {
    const [garden, library] = world().entities
    expect(garden).toMatchObject({ ref: { world: 'https://example.world', type: 'wp:place', id: 'garden' }, version: 1, visibility: 'public', capabilities: [] })
    expect(Date.parse(garden!.updatedAt)).not.toBeNaN()
    expect(library).toMatchObject({ version: 3, updatedAt: '2026-02-01T00:00:00.000Z', relationships: [] })
  })

  it('advertises declared types that have no entities yet', () => {
    const defined = defineWorld({ url: 'https://example.world', name: 'Example', entities, entityTypes: ['wp:person'] })
    expect(defined.discovery.entityTypes).toEqual(['wp:person', 'wp:place', 'wp:event'])
  })

  it('serves the well-known discovery document with public CORS', async () => {
    const response = await world().fetch(new Request('https://example.world/.well-known/world.json', { headers: { origin: 'https://other.site' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    await expect(response.json() as Promise<WorldDiscoveryDocument>).resolves.toMatchObject({ id: 'https://example.world' })
  })

  it('serves lists and gets from the same source, without private entities', async () => {
    const defined = world()
    const list = await (await defined.fetch(new Request('https://example.world/api/world/v0/entities/wp%3Aplace'))).json() as PaginatedEntityCollection
    expect(list.entities.map((entity) => entity.ref.id)).toEqual(['garden', 'library'])
    const got = await (await defined.fetch(new Request('https://example.world/api/world/v0/entities/wp%3Aplace/library'))).json() as EntityEnvelope
    expect(got).toEqual(list.entities[1])
    expect((await defined.fetch(new Request('https://example.world/api/world/v0/entities/wp%3Aplace/vault'))).status).toBe(404)
  })

  it('knows which paths are protocol paths', () => {
    const defined = world()
    expect(defined.handles('https://example.world/.well-known/world.json')).toBe(true)
    expect(defined.handles('https://example.world/api/world/v0')).toBe(true)
    expect(defined.handles('/api/world/v0/entities/wp%3Aplace')).toBe(true)
    expect(defined.handles('/')).toBe(false)
    expect(defined.handles('/api/world/v0x')).toBe(false)
    expect(defined.handles('/app.js')).toBe(false)
  })

  it('rejects duplicate entities', () => {
    expect(() => defineWorld({ url: 'https://example.world', name: 'X', entities: [entities[0]!, { ...entities[0]!, relationships: [] }] }))
      .toThrow(/duplicate entity wp:place\/garden/)
  })

  it('rejects relationships to entities that do not exist', () => {
    expect(() => defineWorld({
      url: 'https://example.world',
      name: 'X',
      entities: [{ type: 'wp:place', id: 'a', attributes: {}, relationships: [{ rel: 'near', target: { type: 'wp:place', id: 'missing' } }] }],
    })).toThrow(/"near" relationship to wp:place\/missing/)
  })

  it('allows relationships to entities in other worlds', () => {
    expect(() => defineWorld({
      url: 'https://example.world',
      name: 'X',
      entities: [{ type: 'wp:place', id: 'a', attributes: {}, relationships: [{ rel: 'sister', target: { world: 'https://other.world', type: 'wp:place', id: 'b' } }] }],
    })).not.toThrow()
  })

  it('rejects a url with a path and an empty world', () => {
    expect(() => defineWorld({ url: 'https://example.world/api/world/v0', name: 'X', entities })).toThrow(/origin/)
    expect(() => defineWorld({ url: 'not a url', name: 'X', entities })).toThrow(/absolute URL/)
    expect(() => defineWorld({ url: 'https://example.world', name: 'X', entities: [] })).toThrow(/at least one entity type/)
  })
})

describe('defineWorld fetch', () => {
  it('accepts URLs and strings like global fetch', async () => {
    const defined = world()
    expect((await defined.fetch('https://example.world/.well-known/world.json')).status).toBe(200)
    expect((await defined.fetch(new URL('https://example.world/api/world/v0/entities/wp%3Aplace'))).status).toBe(200)
    const discovered = await defined.fetch('https://example.world/api/world/v0/actions/wp%3Adiscover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text: 'library' } }),
    })
    const body = await discovered.json() as { output: PaginatedEntityCollection }
    expect(body.output.entities.map((entity) => entity.ref.id)).toEqual(['library'])
  })
})
