# Authentication

World Protocol Level 1 discovery and reads may be public or protected by the world operator. The starter world is public and needs no credentials.

For a protected world, pass a bearer token to `WorldClient`:

```js
import { WorldClient } from '@worlddevkit/client'

const client = await WorldClient.connect('https://your-world.example', {
  accessToken: process.env.WORLD_ACCESS_TOKEN,
})
```

For short-lived credentials, provide an async token supplier. It is evaluated before every API request:

```js
const client = await WorldClient.connect('https://your-world.example', {
  accessToken: async () => tokenCache.getValidToken(),
})
```

The client sends:

```http
Authorization: Bearer <token>
```

Discovery itself does not use `accessToken`; `WorldClient.connect` reads the public `/.well-known/world.json` first. A world-specific authorization service is responsible for issuing tokens. Token issuance is not part of Level 1.

## Custom headers

```js
const client = await WorldClient.connect('https://your-world.example', {
  headers: {
    'user-agent': 'my-world-integration/1.0',
  },
})
```

Do not put permanent secrets in browser bundles. Keep client credentials and token exchange on your server.
