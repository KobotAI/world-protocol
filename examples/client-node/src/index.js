import { WorldClient, WorldHttpError, discoverWorld } from '@worlddevkit/client'

const origin = process.argv[2] ?? 'http://localhost:8787'

const discovery = await discoverWorld(origin)
console.log('discovery', {
  id: discovery.id,
  protocol: discovery.protocol,
  entityTypes: discovery.entityTypes,
})

const client = await WorldClient.connect(origin)
const type = discovery.entityTypes[0]

const firstPage = await client.listEntities(type, { limit: 1 })
console.log('list', firstPage)

const first = firstPage.entities[0]
if (first) {
  const entity = await client.getEntity(first.ref.type, first.ref.id)
  console.log('get', entity)
}

const discovered = await client.discover({
  types: [type],
  text: 'garden',
  limit: 2,
})
console.log('wp:discover', discovered)

for await (const page of client.paginateEntities(type, { limit: 1 })) {
  console.log('page', {
    ids: page.entities.map((entity) => entity.ref.id),
    nextCursor: page.nextCursor,
  })
}

try {
  await client.getEntity(type, 'does-not-exist')
} catch (error) {
  if (error instanceof WorldHttpError) {
    console.log('WorldHttpError', {
      status: error.status,
      code: error.code,
      message: error.message,
      url: error.url,
    })
  } else {
    throw error
  }
}
