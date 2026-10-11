# Run a world server

`@worlddevkit/server` adapts your data source to the framework-neutral Fetch API. You supply discovery metadata and `list`/`get` operations; the package supplies Level 1 routing, protocol errors, pagination, CORS and optional rate limiting.

```sh
npm install @worlddevkit/server @worlddevkit/spec
```

```ts
import { createWorldHandler } from '@worlddevkit/server'
import { WORLD_PROTOCOL_VERSION } from '@worlddevkit/spec'

const world = {
  protocol: WORLD_PROTOCOL_VERSION,
  id: 'https://world.example',
  name: 'Example World',
  endpoints: { api: 'https://world.example/api/world/v0' },
  entityTypes: ['wp:store'],
  actions: ['wp:discover'],
}

const handler = createWorldHandler({
  world,
  source: {
    async list(type) {
      return type === 'wp:store' ? stores : []
    },
    async get(type, id) {
      return stores.find((entity) =>
        entity.ref.type === type && entity.ref.id === id
      ) ?? null
    },
  },
})
```

Mount `handler(request)` at the API endpoint declared in the discovery document and serve `world` as JSON from `/.well-known/world.json`.

For an executable Node HTTP adapter, in-memory fixtures, and conformance tests, generate a complete TypeScript starter:

```sh
npm create worlddevkit@latest my-world
```
