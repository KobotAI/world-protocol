import type { WorldEntityInput } from '@worlddevkit/server'

/**
 * The single source of truth for this world. The Level 1 API and the website in `public/` both
 * read these entities, so they can never disagree.
 *
 * Replace them with your own. Keep IDs stable once anyone links to them, and bump `version`
 * whenever an entity's data changes.
 */
export const entities: WorldEntityInput[] = [
  place('central-garden', 'Central Garden', 'park', 'Lawns, a lily pond and shaded benches at the heart of town.', ['north-library', 'riverside-market']),
  place('north-library', 'North Library', 'library', 'Three floors of books, a quiet reading room and free public workshops.', ['central-garden', 'clock-tower']),
  place('riverside-market', 'Riverside Market', 'market', 'Fresh produce, street food and crafts along the water every morning.', ['central-garden', 'old-pier']),
  place('old-pier', 'Old Pier', 'landmark', 'A restored timber pier with views across the bay at sunset.', ['riverside-market']),
  place('clock-tower', 'Clock Tower', 'landmark', 'The town’s oldest building, with a viewing gallery open at weekends.', ['north-library']),
  place('hillside-park', 'Hillside Park', 'park', 'Walking trails, a playground and the best picnic spot in town.', []),
]

function place(id: string, name: string, category: string, description: string, near: string[]): WorldEntityInput {
  return {
    type: 'wp:place',
    id,
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    attributes: { name, category, description },
    relationships: near.map((target) => ({ rel: 'near', target: { type: 'wp:place', id: target } })),
  }
}
