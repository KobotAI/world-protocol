# Node client

A Node.js 20+ ESM consumer of a World Protocol Level 1 server. It demonstrates:

- standalone discovery with `discoverWorld`
- discovery and connection with `WorldClient.connect`
- `listEntities` and `getEntity`
- canonical `wp:discover` through `client.discover`
- opaque-cursor pagination with `paginateEntities`
- typed non-2xx handling with `WorldHttpError`

## Run against the minimal world

Start [`../minimal-world`](../minimal-world) in one terminal:

```sh
cd ../minimal-world
npm install
npm start
```

Then run this consumer in another terminal:

```sh
npm install
npm start
```

The default origin is `http://localhost:8787`. Pass another world origin as the first argument:

```sh
node src/index.js https://world.example
```

The client discovers the API endpoint from `/.well-known/world.json`; it does not hardcode API routes, parse cursors, require credentials, or use a database.
