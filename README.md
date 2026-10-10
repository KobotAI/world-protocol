# World Protocol

World Protocol is an open protocol for discovery and interaction across independent virtual worlds. WorldKit is its framework-neutral TypeScript implementation.

The Level 1 release focuses on public discovery and entity reads. It gives world operators a small Fetch API server adapter, an environment-neutral client, runtime contracts and schemas, and a reusable conformance suite.

## Packages

| Package | Purpose |
|---|---|
| `@worlddevkit/spec` | TypeScript contracts and dependency-free JSON Schemas |
| `@worlddevkit/server` | Framework-neutral Fetch API handler, pagination, CORS and rate limiting |
| `@worlddevkit/client` | World discovery, typed reads, pagination and errors |
| `@worlddevkit/testing` | Level 1 conformance runner for world implementations |

## Install

```sh
npm install @worlddevkit/client @worlddevkit/spec
```

For a world server:

```sh
npm install @worlddevkit/server @worlddevkit/spec
```

For conformance testing:

```sh
npm install --save-dev @worlddevkit/testing
```

## Minimal client

```ts
import { WorldClient } from '@worlddevkit/client'

const world = await WorldClient.connect('https://world.example')
const stores = await world.listEntities('wp:store', { limit: 20 })
```

A compatible world publishes `/.well-known/world.json` and mounts its Level 1 API at the endpoint declared by that document.

## Minimal server

```ts
import { createWorldHandler } from '@worlddevkit/server'
import { WORLD_PROTOCOL_VERSION } from '@worlddevkit/spec'

const handler = createWorldHandler({
  world: {
    protocol: WORLD_PROTOCOL_VERSION,
    id: 'https://world.example',
    name: 'Example World',
    endpoints: { api: 'https://world.example/api/world/v0' },
    entityTypes: ['wp:store'],
    actions: ['wp:discover'],
  },
  source: {
    async list() {
      return []
    },
    async get() {
      return null
    },
  },
})
```

See the package READMEs and `examples/` for complete usage.

## Development

Requirements: Node.js 20+ and pnpm 10.17.1.

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Each package remains independently installable and has its own frozen lockfile. Release artifacts are staged and verified as a clean external consumer before publishing.

## Releases

Releases are performed by the guarded `WorldKit Release` GitHub Actions workflow using npm trusted publishing and GitHub OIDC. Source package manifests remain private as an accidental-publish guard; the release staging script creates audited public manifests.

## Status

World Protocol and WorldKit are pre-1.0. Level 1 APIs follow semantic versioning, but breaking changes may occur in minor versions until 1.0.

## License

Code is licensed under Apache-2.0. Contributions require Developer Certificate of Origin sign-off; see `CONTRIBUTING.md`.
