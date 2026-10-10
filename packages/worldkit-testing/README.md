# `@worlddevkit/testing`

A Fetch-based World Protocol Level 1 conformance runner. It can probe a running URL or test a Fetch-compatible handler entirely in memory.

## Requirements

- Node.js 20 or newer
- ESM

## Install

```sh
npm install --save-dev @worlddevkit/testing@^0.1.0
```

## Assert conformance

Against a running world:

```ts
import { assertLevel1Conformance } from '@worlddevkit/testing'

const report = await assertLevel1Conformance({
  world: 'https://world.example',
})

console.log(report.checks)
```

Against an in-memory handler:

```ts
import { assertLevel1Conformance } from '@worlddevkit/testing'
import { fetchWorld } from './world.js'

await assertLevel1Conformance(
  { world: 'https://world.example', fetch: fetchWorld },
  { pageSize: 1 },
)
```

Use `runLevel1Conformance` when you want a report without throwing. `assertLevel1Conformance` throws `Level1ConformanceError` when any check fails and exposes the complete report on `error.report`.

The Level 1 checks cover:

- discovery document validity
- entity envelope validity
- terminating opaque-cursor pagination
- list/get consistency
- protocol errors for unknown entities
- public-read CORS
- `wp:discover`
- advertised entity-type boundaries

The target must advertise at least one entity type and `wp:discover`. Set `pageSize`, `maxPagesPerType`, or `corsOrigin` through the optional second argument.

See [`examples/minimal-world`](../../examples/minimal-world) for a runnable in-memory conformance test.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
