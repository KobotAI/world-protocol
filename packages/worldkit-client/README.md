# `@worlddevkit/client`

Fetch-based ESM client for discovering and reading any World Protocol Level 1 world. It uses the platform Fetch API available in Node.js 20+ and modern browsers.

## Requirements

- Node.js 20 or newer
- ESM

## Install

```sh
npm install @worlddevkit/client@^0.1.0
```

## Connect and read

```ts
import { WorldClient } from '@worlddevkit/client'

const client = await WorldClient.connect('https://world.example')
const firstPage = await client.listEntities('wp:place', { limit: 20 })
const place = await client.getEntity('wp:place', firstPage.entities[0].ref.id)
const matches = await client.discover({
  types: ['wp:place'],
  text: 'garden',
  limit: 20,
})
```

`connect` fetches `/.well-known/world.json` and uses its advertised API endpoint. To fetch only that document, use `discoverWorld`.

## Pagination

Iterate pages:

```ts
for await (const page of client.paginateEntities('wp:place', { limit: 10 })) {
  console.log(page.entities, page.nextCursor)
}
```

Or iterate entities directly:

```ts
for await (const entity of client.entities('wp:place', { limit: 10 })) {
  console.log(entity.ref)
}
```

Cursors are opaque; do not parse or synthesize them.

## Errors

- `WorldHttpError`: non-success HTTP response; inspect `status`, `code`, `details`, and `url`
- `WorldNetworkError`: Fetch failed before receiving a response
- `WorldResponseError`: invalid discovery, JSON, entity, or collection response
- `WorldClientError`: common base class

```ts
import { WorldHttpError } from '@worlddevkit/client'

try {
  await client.getEntity('wp:place', 'missing')
} catch (error) {
  if (error instanceof WorldHttpError) {
    console.error(error.status, error.code)
  } else {
    throw error
  }
}
```

`WorldClient` also accepts a custom `fetch`, static headers, and a string or async bearer-token provider.

See [`examples/client-node`](../../examples/client-node) for a complete Node consumer covering discovery, list/get, `wp:discover`, pagination, and typed HTTP errors.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
