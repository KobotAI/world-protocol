# How discovery works

A client starts from a world origin, not a hardcoded API route.

For a local starter world, discovery is:

```http
GET http://localhost:8787/.well-known/world.json
Accept: application/json
```

The document declares the protocol version, canonical world ID, API endpoint, entity types and actions supported by that world.

```js
import { discoverWorld, WorldClient } from '@worlddevkit/client'

const document = await discoverWorld('http://localhost:8787')
console.log(document.protocol, document.endpoints.api)

const client = new WorldClient(document)
```

`WorldClient.connect(origin)` combines those operations:

```js
const client = await WorldClient.connect('http://localhost:8787')
```

## Why clients discover

* Operators can move or version an API without changing the world origin.
* Clients can inspect supported entity types and actions before calling them.
* One client implementation can connect to independent worlds.

Treat `endpoints.api` as an absolute, operator-controlled URL. Do not derive it from the origin, guess an `/api/v1` route or rewrite its version.
