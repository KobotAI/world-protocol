import { WorldClient } from '@worlddevkit/client'

const origin = process.argv.slice(2).find((argument) => argument !== '--') ?? 'http://localhost:8787'
const client = await WorldClient.connect(origin)
const entityType = client.world.entityTypes[0]

if (!entityType) {
  throw new Error(`World advertises no entity types: ${origin}`)
}

const page = await client.listEntities(entityType, { limit: 5 })

if (page.entities.length === 0) {
  throw new Error(`World returned no ${entityType} entities: ${origin}`)
}

for (const entity of page.entities) {
  console.log(entity.ref.id, entity.attributes.name)
}

console.log('next cursor:', page.nextCursor)
