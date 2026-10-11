# Node client

A Node.js 20+ ESM consumer of a World Protocol Level 1 server. It demonstrates:

- standalone discovery with `discoverWorld`
- discovery and connection with `WorldClient.connect`
- `listEntities` and `getEntity`
- canonical `wp:discover` through `client.discover`
- opaque-cursor pagination with `paginateEntities`
- typed non-2xx handling with `WorldHttpError`

## Run against the local starter

Start the minimal world from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm quickstart
```

In another terminal, query it:

```sh
pnpm --dir examples/client-node quickstart
```

The quickstart defaults to `http://localhost:8787`. To query your deployed world, pass its public origin:

```sh
pnpm --dir examples/client-node quickstart -- https://your-world.example
```

## Run the complete client example

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

The complete example defaults to `http://localhost:8787`. Pass another world origin as the first argument:

```sh
node src/index.js https://your-world.example
```

The client discovers the API endpoint from `/.well-known/world.json`; it does not hardcode API routes, parse cursors, require credentials, or use a database.
