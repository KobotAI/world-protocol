import assert from 'node:assert/strict'
import test from 'node:test'
import { WorldClient } from '@worlddevkit/client'
import { assertLevel1Conformance } from '@worlddevkit/testing'

process.env.WORLD_URL = 'https://starter.world'
const { discovery, fetchWorld } = await import('../src/world.js')

test('world conforms to World Protocol Level 1', async () => {
  await assertLevel1Conformance(
    { world: discovery.id, fetch: fetchWorld },
    { pageSize: 1 },
  )
})

test('published client can list the in-memory places', async () => {
  const client = new WorldClient(discovery, { fetch: fetchWorld })
  const result = await client.listEntities('wp:place')

  assert.equal(result.entities.length, 3)
  assert.equal(result.entities[0]?.ref.type, 'wp:place')
})
