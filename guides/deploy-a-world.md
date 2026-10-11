# Deploy a world

A WorldDevKit server is an ordinary Node.js 20 process. It needs one public HTTPS origin and no central control plane.

## Runtime contract

Configure the starter with:

| Variable | Example | Purpose |
|---|---|---|
| `WORLD_URL` | `https://your-world.example` | Canonical public origin and API URL base |
| `HOST` | `0.0.0.0` | Accept traffic from the hosting platform |
| `PORT` | Supplied by host | HTTP listener port; defaults to `8787` |

Use these platform commands:

```text
Install: npm ci
Build: npm run build
Start: node dist/src/server.js
Health check: /api/world/v0
```

## DNS and TLS

1. Point `your-world.example` at the hosting platform.
2. Enable HTTPS.
3. Set `WORLD_URL=https://your-world.example`.
4. Route every path to the same Node process.

Do not mount only `/api/world/v0`. Discovery must remain available at:

```text
https://your-world.example/.well-known/world.json
```

## Verify production

```sh
curl https://your-world.example/.well-known/world.json
curl 'https://your-world.example/api/world/v0/entities/wp%3Aplace'
```

Protocol repository contributors can additionally run:

```sh
node scripts/worldkit/check-live-level1.mjs https://your-world.example
```

The discovery document must advertise the same HTTPS origin clients use. Never advertise `localhost`, a container hostname or an internal bind address.

## Scaling

The starter keeps entities and rate limits in process. Before running multiple instances:

* replace the in-memory entity source with shared durable storage;
* replace `createMemoryRateLimiter` with a shared limiter;
* keep entity IDs stable;
* deploy backwards-compatible schema changes before new writers.

The protocol handler itself is stateless and can run behind any HTTP load balancer once those adapters are shared.
