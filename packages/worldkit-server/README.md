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

Extensionless paths with no matching file fall back to `index.html` for client-side routing (set `fallback: false` to disable).

To serve a browser library installed from npm (for example Three.js) without copying it or adding a build step, combine `prefix` with `resolvePackageDirectory`:

```ts
import { createStaticHandler, resolvePackageDirectory } from '@worlddevkit/server/node'

const three = createStaticHandler({
  root: resolvePackageDirectory('three', 'build', import.meta.url),
  prefix: '/vendor/three/',
  fallback: false,
})
// then route /vendor/three/* to it, and map "three" to /vendor/three/three.module.min.js in an import map
``` Paths outside `root`, including through symlinks, answer 404. This entry point uses `node:fs`; the main entry point stays runtime-neutral.

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

## Level 2: actions, sessions and live events

Add `actions` to `defineWorld` and the world accepts changes. See the [Level 2 API reference](../../reference/level-2-api.md) for the wire format.

```ts
import { ActionError, defineWorld } from '@worlddevkit/server'

const world = defineWorld({
  url: 'https://plots.example',
  name: 'Plots',
  entities: [{ type: 'game:plot', id: 'p1', attributes: { owner: null }, capabilities: ['game:claim'] }],
  actions: {
    'game:claim': {
      targetTypes: ['game:plot'],
      handler({ target, caller, world }) {
        if (target!.attributes.owner) throw new ActionError('taken', 'Already claimed')
        world.update('game:plot', target!.ref.id, { attributes: { owner: caller!.id }, capabilities: [] })
        return { claimed: target!.ref.id }
      },
    },
  },
})

// Server-driven changes run in the same one-at-a-time queue as actions:
setInterval(() => world.change((store) => store.emit('game:tick', Date.now())), 10_000) // declare 'game:tick' in events
```

| Option | What it does |
| --- | --- |
| `actions` | `{ 'ns:name': { handler, requiresCaller?, requiresAdmin?, targetTypes?, prepare? } }`. `prepare` runs slow work (network calls) before the action joins the queue; its result arrives as `prepared`. Handlers get `input`, `target`, `ifVersion`, `caller` and `world` (`get`, `list`, `create`, `update`, `remove`, `emit`), and return the output. Throw `ActionError(code, message, status?)` to refuse. |
| `events` | World-defined event names handlers may `emit`. |
| `entityTypes` | Types the world advertises, including ones only created at runtime. |
| `sessions` | Session store; in-memory, 24-hour sessions by default (`createMemorySessions`). |
| `actionRateLimiter` | Per-session action limit; 120 a minute by default. |
| `sessionRateLimiter` | New sessions per client address; 10 a minute by default. |
| `adminToken` | The owner's secret (16+ characters, from an environment variable). Sent as a Bearer token, it runs `requiresAdmin` actions. |

The kit enforces sessions, target capabilities and `ifVersion` before your handler runs, runs actions one at a time, and publishes every public change on `{api}/events`. Building on `createWorldHandler` directly, pass `actions: createActionDispatcher(...)` and `events: createEventHub()`.

## Sharing assets between worlds

Publish products or items with `defineAsset`, and host other worlds' assets with `placements`. See [Assets and placements](../../reference/assets-and-placements.md).

```ts
import { defineAsset, defineWorld } from '@worlddevkit/server'

const shop = defineWorld({ url, name, entities: [defineAsset({ id: 'stove', name: 'Gas Stove', image: { url: img, alt: 'A gas stove' }, web: page })] })

const game = defineWorld({ url, name, entities, adminToken: process.env.WORLD_ADMIN_TOKEN, placements: { max: 5 } })
const stop = game.placements!.startSync() // poll sources and follow their live events
```

Hosts fetch other worlds over https only, refuse private addresses and redirects, cap sizes and time, and run fetches outside the action queue (an action's `prepare` step), so slow publishers never delay players.

## Options

Both `defineWorld` and `createWorldHandler` accept:

| Option | Default | What it does |
| --- | --- | --- |
| `searchFields` | `['name', 'description', 'tagline', 'category']` | Attributes `wp:discover` text search matches: one list for every type, or `{ 'wp:person': ['name', 'bio'] }` per type. |
| `trustProxy` | `1` | Reverse proxies in front of the server that append to `X-Forwarded-For`. The rate limiter keys clients by the address the outermost trusted proxy recorded, so a client cannot forge its own key. Use `false` when nothing in front of the server sets the header. |
| `clientKey` | none | `(request) => string \| undefined`. Derives the rate-limit key yourself, for example from `CF-Connecting-IP`. Takes precedence over `trustProxy`. |
| `maxPageSize` | `50` | Upper bound for `limit`. |
| `cors` | `*` with `defineWorld` | Allowed origins for browser reads. |

Successful reads are cacheable for 60 seconds. Error responses, including 429s, are sent with `Cache-Control: no-store`.

See [`examples/minimal-world`](../../examples/minimal-world) for a runnable Node HTTP adapter and conformance test.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
