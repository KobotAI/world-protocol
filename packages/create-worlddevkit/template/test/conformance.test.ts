import assert from 'node:assert/strict'
import test from 'node:test'
import { WorldClient } from '@worlddevkit/client'
import { assertLevel1Conformance } from '@worlddevkit/testing'

process.env.WORLD_URL = 'https://starter.world'
const { world, discovery, fetchWorld } = await import('../src/world.js')
const { entities } = await import('../src/data.js')

test('world conforms to World Protocol Level 1', async () => {
  await assertLevel1Conformance(
    { world: discovery.id, fetch: fetchWorld },
    { pageSize: 1 },
  )
})

test('the API serves every entity in src/data.ts', async () => {
  const client = new WorldClient(discovery, { fetch: fetchWorld })
  let served = 0
  for (const type of discovery.entityTypes) {
    for await (const page of client.paginateEntities(type, { limit: 50 })) served += page.entities.length
  }
  assert.equal(served, entities.filter((entity) => (entity.visibility ?? 'public') === 'public').length)
})

test('every relationship points at an entity the API can return', async () => {
  const client = new WorldClient(discovery, { fetch: fetchWorld })
  for (const entity of world.entities) {
    for (const { target } of entity.relationships) {
      if (target.world !== undefined && target.world !== discovery.id) continue
      const related = await client.getEntity(target.type, target.id)
      assert.equal(related.ref.id, target.id)
    }
  }
})
