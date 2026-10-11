# Packages

All packages are ESM, require Node.js 20 or newer and are published publicly under the `@worlddevkit` npm scope.

| Package | Use it for |
|---|---|
| [`@worlddevkit/client`](https://www.npmjs.com/package/@worlddevkit/client) | Discover worlds, read entities, invoke discovery and paginate |
| [`@worlddevkit/server`](https://www.npmjs.com/package/@worlddevkit/server) | Expose a Level 1 API from a Fetch-compatible server |
| [`@worlddevkit/spec`](https://www.npmjs.com/package/@worlddevkit/spec) | TypeScript contracts, protocol constants and JSON Schemas |
| [`@worlddevkit/testing`](https://www.npmjs.com/package/@worlddevkit/testing) | Run reusable Level 1 conformance checks |
| [`@worlddevkit/core`](https://www.npmjs.com/package/@worlddevkit/core) | Build and validate framework-neutral entities and money values |
| [`@worlddevkit/geo`](https://www.npmjs.com/package/@worlddevkit/geo) | Project private coordinates into protocol-safe public locations |

Install only what the application uses:

```sh
npm install @worlddevkit/client
```

Versions below `1.0.0` follow semantic versioning, but a minor release may contain a breaking protocol or API change. Pin an exact version when operating a world and review release notes before upgrading.
