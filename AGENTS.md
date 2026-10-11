# WorldDevKit agent instructions

Use these rules when creating or changing a world in this repository.

## Start here

1. Read `docs/getting-started/quickstart.md`.
2. Read `docs/agents/build-a-world.md`.
3. Start from `examples/minimal-world`.
4. Use only public `@worlddevkit/*` APIs. Do not import private package internals.

## Compatibility rules

- Preserve discovery at `GET /.well-known/world.json`.
- Preserve the Level 1 API under `/api/world/v0` unless the discovery document advertises a different public endpoint.
- Keep public entity IDs stable after clients can observe them.
- Keep `ref.world`, discovery `id`, and the externally reachable world identity consistent.
- Set production identity and endpoints from `WORLD_URL`; never hardcode a container, bind, or loopback origin into production discovery.
- Keep the local default at `http://localhost:8787`.
- Do not add a database, authentication, Docker, a framework, or cloud-specific infrastructure unless the task explicitly requires it.
- Never claim an unpublished package or command exists.

## Preferred edit surface

- Change `examples/minimal-world/src/world.js` for world metadata, entity types, fixtures, and `source.list`/`source.get`.
- Leave `examples/minimal-world/src/server.js` unchanged unless the HTTP adapter itself must change.
- Update conformance tests whenever protocol behavior changes.

## Required validation

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm --dir examples/minimal-world test
```

For a running local world, also run:

```sh
pnpm quickstart
```

Then, in another terminal:

```sh
pnpm --dir examples/client-node quickstart
```

Do not use local Docker. Do not require credentials for the starter.