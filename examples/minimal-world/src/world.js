import { defineWorld } from '@worlddevkit/server'

const port = process.env.PORT ?? '8787'

/**
 * `defineWorld` derives the discovery document, `ref.world`, the advertised entity types and the
 * list/get source from this one entity list, and serves `/.well-known/world.json` plus the
 * Level 1 API. Set `WORLD_URL` to the public HTTPS origin in production.
 */
export const world = defineWorld({
  url: process.env.WORLD_URL ?? `http://localhost:${port}`,
  name: 'Minimal Synthetic World',
  description: 'A credential-free, in-memory World Protocol Level 1 example.',
  entities: [
    place('central-garden', 'Central Garden', 'park', ['north-library']),
    place('north-library', 'North Library', 'library', ['central-garden']),
    place('riverside-market', 'Riverside Market', 'market', []),
  ],
  maxPageSize: 50,
})

export const discovery = world.discovery
export const fetchWorld = world.fetch

function place(id, name, category, near) {
  return {
    type: 'wp:place',
    id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    attributes: { name, category },
    relationships: near.map((target) => ({ rel: 'near', target: { type: 'wp:place', id: target } })),
  }
}
