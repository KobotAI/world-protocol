# My World

A credential-free, database-free, Docker-free World Protocol Level 1 server built with WorldDevKit.

## Start

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

The default server listens at `http://127.0.0.1:8787`. Copy `.env.example` to `.env`, then export those variables in your shell or deployment environment if you need different values. The starter intentionally does not include credentials.

Try the discovery document and Level 1 API:

```sh
curl http://localhost:8787/.well-known/world.json
curl 'http://localhost:8787/api/world/v0/entities/wp%3Aplace'
curl -X POST http://localhost:8787/api/world/v0/actions/wp%3Adiscover \
  -H 'content-type: application/json' \
  -d '{"input":{"types":["wp:place"],"text":"garden"}}'
```

## Commands

```sh
npm run dev          # Run the TypeScript server in watch mode
npm run build        # Compile to dist/
npm run typecheck    # Strict TypeScript check without emitting
npm test             # Build and run all tests
npm run conformance  # Build and run the Level 1 conformance test
```

## Customize

Edit `src/world.ts` to change world metadata, add entities, or replace the in-memory `EntitySource`. Keep `/.well-known/world.json` reachable at the public origin and keep `WORLD_URL` aligned with that origin.

See [`AGENTS.md`](./AGENTS.md) for extension and deployment guidance.
