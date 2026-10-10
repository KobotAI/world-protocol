import test from 'node:test'
import { assertLevel1Conformance } from '@worlddevkit/testing'
import { discovery, fetchWorld } from '../src/world.js'

test('minimal world conforms to World Protocol Level 1', async () => {
  await assertLevel1Conformance(
    { world: discovery.id, fetch: fetchWorld },
    { pageSize: 1 },
  )
})
