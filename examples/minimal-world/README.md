# Minimal World

A synthetic, credential-free, database-free World Protocol Level 1 server for Node.js 20+. It exposes:

- `GET /.well-known/world.json`
- `GET /api/world/v0`
- list/get routes for `wp:place`
- canonical `POST /api/world/v0/actions/wp%3Adiscover`
- opaque-cursor pagination and protocol errors

The example uses `createWorldHandler` from `@worlddevkit/server`; `src/world.js` exports the discovery document, the handler, and a Fetch-compatible `fetchWorld` function.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm quickstart
```

`pnpm quickstart` builds the public packages and starts this example.

The server listens at `http://localhost:8787`:

```sh
curl http://localhost:8787/.well-known/world.json
curl 'http://localhost:8787/api/world/v0/entities/wp%3Aplace?limit=1'
curl -X POST 'http://localhost:8787/api/world/v0/actions/wp%3Adiscover' \
  -H 'content-type: application/json' \
  -d '{"input":{"types":["wp:place"],"text":"garden","limit":10}}'
```

## Run Level 1 conformance

```sh
npm test
```

The test passes `fetchWorld` directly to `@worlddevkit/testing`, so it does not open a port or need TLS. A page size of one forces pagination to be exercised.

The discovery identity is the reserved synthetic URL `https://minimal-world.example`; the advertised API endpoint points at the local Node adapter. No request is sent to the `.example` domain.

## Make it yours

Edit `src/world.js` to change metadata, entity types, fixtures, and the `source.list`/`source.get` methods. Keep `src/server.js` unchanged unless you need a different Node adapter. Keep public entity IDs stable.

## Deploy

The server reads `HOST`, `PORT`, and `WORLD_URL`:

```sh
HOST=0.0.0.0 PORT=8787 WORLD_URL=https://your-world.example npm start
```

Your platform can provide `PORT`. Set `WORLD_URL` to the externally reachable HTTPS origin so discovery advertises the correct API URL. No database, credentials, or Docker are required.

To exercise this server with the separate Node client example, keep it running and run `pnpm --dir examples/client-node quickstart` from the repository root.
