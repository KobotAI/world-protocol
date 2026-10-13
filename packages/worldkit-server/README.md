# `@worlddevkit/server`

A framework-neutral Fetch API handler for serving World Protocol Level 1 entities and `wp:discover` from any Node.js 20+ HTTP stack that can adapt to `Request` and `Response`.

Storage is application-owned. Implement `EntitySource` with synthetic data, an API, files, or your persistence layer; WorldDevKit does not require a database.

## Requirements

- Node.js 20 or newer
- ESM

## Install

```sh
npm install @worlddevkit/server@^0.2.0 @worlddevkit/spec@^0.2.0
```

## Define a world

`defineWorld` builds the discovery document, the `EntitySource` and a Fetch handler for both `/.well-known/world.json` and the Level 1 API from one list of entities, so they cannot drift apart:

```ts
import { defineWorld } from '@worlddevkit/server'

export const world = defineWorld({
  url: process.env.WORLD_URL ?? 'http://localhost:8787', // public origin, no path
  name: 'Lagos Street Food',
  description: 'Where to eat, by neighbourhood.',
  entities: [
    { type: 'wp:place', id: 'yaba', attributes: { name: 'Yaba', category: 'neighbourhood' } },
    {
      type: 'wp:store',
      id: 'iya-basira',
      attributes: { name: 'Iya Basira', category: 'buka' },
      relationships: [{ rel: 'in', target: { type: 'wp:place', id: 'yaba' } }],
    },
  ],
})

await world.fetch('http://localhost:8787/.well-known/world.json') // same signature as fetch
world.handles('/api/world/v0/entities/wp%3Aplace') // true: route it to world.fetch
```

`entityTypes`, `ref.world`, `version: 1`, `visibility: 'public'` and `updatedAt` are filled in for you. Duplicate IDs and relationships to entities missing from the world throw when `defineWorld` runs, before the server starts.

## Serve a website

`@worlddevkit/server/node` serves a directory of static files, so a world's website and its API can share one origin:

```ts
import { createStaticHandler } from '@worlddevkit/server/node'

const site = createStaticHandler({ root: new URL('../public/', import.meta.url) })

export const handleRequest = (request: Request) =>
  world.handles(request.url) ? world.fetch(request) : site(request)
```

Extensionless paths with no matching file fall back to `index.html` for client-side routing (set `fallback: false` to disable). Paths outside `root`, including through symlinks, answer 404. This entry point uses `node:fs`; the main entry point stays runtime-neutral.

## Create a handler

For full control over storage, implement `EntitySource` yourself and use `createWorldHandler`:

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

Level 1 is public-read only. The handler serves only entities whose `visibility` is `public`: lists and discovery skip the rest, and `get` answers 404 for them as if they did not exist.

When you use `createWorldHandler` directly, your host adapter must separately expose the same discovery document at `/.well-known/world.json`. The package deliberately does not assume a framework or own the origin-level route.

The in-memory rate limiter is appropriate for examples, tests, and one-process deployments. Use a shared `RateLimiter` implementation when requests can reach multiple processes.

See [`examples/minimal-world`](../../examples/minimal-world) for a runnable Node HTTP adapter and conformance test.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
