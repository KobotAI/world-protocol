import test from 'node:test'
import { assertLevel1Conformance } from '@worlddevkit/testing'

// Conformance requires an HTTPS world identity; set one before the world is defined.
process.env.WORLD_URL = 'https://minimal-world.example'
const { discovery, fetchWorld } = await import('../src/world.js')

test('minimal world conforms to World Protocol Level 1', async () => {
  await assertLevel1Conformance(
    { world: discovery.id, fetch: fetchWorld },
    { pageSize: 1 },
  )
})
