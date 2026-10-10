# Minimal World

A synthetic, credential-free, database-free World Protocol Level 1 server for Node.js 20+. It exposes:

- `GET /.well-known/world.json`
- `GET /api/world/v0`
- list/get routes for `wp:place`
- canonical `POST /api/world/v0/actions/wp%3Adiscover`
- opaque-cursor pagination and protocol errors

The example uses `createWorldHandler` from `@worlddevkit/server`; `src/world.js` exports the discovery document, the handler, and a Fetch-compatible `fetchWorld` function.

## Run

```sh
npm install
npm start
```

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

To exercise this server with the separate Node client example, keep `npm start` running and run `npm start` from [`../client-node`](../client-node).
