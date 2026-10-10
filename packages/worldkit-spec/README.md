# `@worlddevkit/spec`

Protocol types and dependency-free JSON Schema objects for World Protocol Level 1 (`world/0.1`). This package is the shared wire contract for WorldKit servers, clients, and conformance tools.

## Requirements

- Node.js 20 or newer
- ESM

## Install

```sh
npm install @worlddevkit/spec@^0.1.0
```

## Type a discovery document and entity

```ts
import {
  WORLD_PROTOCOL_VERSION,
  type EntityEnvelope,
  type WorldDiscoveryDocument,
} from '@worlddevkit/spec'

const world: WorldDiscoveryDocument = {
  protocol: WORLD_PROTOCOL_VERSION,
  id: 'https://world.example',
  name: 'Example World',
  endpoints: { api: 'https://world.example/api/world/v0' },
  entityTypes: ['wp:place'],
  actions: ['wp:discover'],
}

const place: EntityEnvelope<{ name: string; category: string }> = {
  ref: { world: world.id, type: 'wp:place', id: 'central-garden' },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  visibility: 'public',
  attributes: { name: 'Central Garden', category: 'park' },
  relationships: [],
  capabilities: [],
}
```

## Runtime schemas

The package exports JSON Schema Draft 2020-12 objects without requiring a validator:

- `worldDiscoveryDocumentSchema`
- `entityRefSchema`
- `entityEnvelopeSchema`
- `paginatedEntityCollectionSchema`
- `discoverQuerySchema`
- `discoverResultSchema`
- `protocolErrorSchema`

Use them with any Draft 2020-12-compatible validator:

```ts
import { entityEnvelopeSchema } from '@worlddevkit/spec'

console.log(entityEnvelopeSchema.$id)
```

## Main exports

Types include `WorldDiscoveryDocument`, `EntityEnvelope`, `PaginatedEntityCollection`, `DiscoverQuery`, `DiscoverResult`, `ProtocolError`, and the JSON value types. `WORLD_PROTOCOL_VERSION` is the runtime protocol version constant.

See [`examples/minimal-world`](../../examples/minimal-world) for a complete synthetic Level 1 world.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
