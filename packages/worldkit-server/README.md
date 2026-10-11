# `@worlddevkit/server`

A framework-neutral Fetch API handler for serving World Protocol Level 1 entities and `wp:discover` from any Node.js 20+ HTTP stack that can adapt to `Request` and `Response`.

Storage is application-owned. Implement `EntitySource` with synthetic data, an API, files, or your persistence layer; WorldDevKit does not require a database.

## Requirements

- Node.js 20 or newer
- ESM

## Install

```sh
npm install @worlddevkit/server@^0.1.0 @worlddevkit/spec@^0.1.0
```

## Create a handler

```ts
import { createMemoryRateLimiter, createWorldHandler } from '@worlddevkit/server'
import { WORLD_PROTOCOL_VERSION, type EntityEnvelope } from '@worlddevkit/spec'

const entities: EntityEnvelope[] = []

const world = {
  protocol: WORLD_PROTOCOL_VERSION,
  id: 'https://world.example',
  name: 'Example World',
  endpoints: { api: 'https://world.example/api/world/v0' },
  entityTypes: ['wp:place'],
  actions: ['wp:discover'],
}

const handler = createWorldHandler({
  world,
  source: {
    async list(type) {
      return entities.filter((entity) => entity.ref.type === type)
    },
    async get(type, id) {
      return entities.find((entity) => entity.ref.type === type && entity.ref.id === id) ?? null
    },
  },
  rateLimiter: createMemoryRateLimiter({ limit: 60, windowMs: 60_000 }),
  cors: '*',
})
```

`handler(request)` serves the API base document, entity list/get routes, the canonical `POST /actions/wp%3Adiscover` action, compatibility discovery aliases, CORS preflights, cursor pagination, and protocol errors.

Your host adapter must separately expose the same discovery document at `/.well-known/world.json`. The package deliberately does not assume a framework or own the origin-level route.

The in-memory rate limiter is appropriate for examples, tests, and one-process deployments. Use a shared `RateLimiter` implementation when requests can reach multiple processes.

See [`examples/minimal-world`](../../examples/minimal-world) for a runnable Node HTTP adapter and conformance test.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
