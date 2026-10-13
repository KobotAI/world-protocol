# World development guide

This project is a World Protocol Level 1 world: a public website for exploring a set of entities, plus a read-only API that exposes the same entities to other software. It already runs end to end. Your job is to make it the world described in the brief.

## Where things live

| File | What it is | Change it when |
| --- | --- | --- |
| `src/data.ts` | Every entity in the world. The single source of truth for the API and the website. | Always: replace the sample places. |
| `src/world.ts` | World name, description and `WORLD_URL`, via `defineWorld`. | Always: rename and describe the world. |
| `public/` | The website: `index.html`, `app.js`, `styles.css`. It reads data only through the API. | Always: build the explore experience here. |
| `src/app.ts` | Sends protocol paths to the API and everything else to `public/`. | Only to add your own non-protocol routes. |
| `src/server.ts` | Node HTTP adapter. Streams responses, so live events work. | Rarely. |
| `test/` | Conformance, data and website tests. | When you add entity types or journeys. |

## Level 1 or Level 2

The starter is **Level 1, read-only**: discovery, list, get and `wp:discover` search. That fits worlds people explore.

If people change the world (a game, claims, votes, anything others should see live), make it **Level 2** by adding `actions` to `defineWorld` in `src/world.ts`. The kit then adds sessions, the actions API and a live events stream at `/api/world/v0/events`, and this project's Node adapter already streams them. Follow the "Level 2" section of the build guide (`guides/build-a-world.md` in the WorldDevKit docs). Never advertise an action you have not implemented, and never put secrets (answers, hidden cards) in public entities.

## Rules

- Add entities in `src/data.ts`. `defineWorld` derives `entityTypes`, `ref.world` and `list`/`get` from them, and throws at startup on duplicate IDs or relationships to entities that do not exist.
- Keep IDs stable once anyone could link to them. Bump `version` and `updatedAt` when an entity's data changes.
- Only `public` entities are served. Never put private data (home addresses, private phone numbers, credentials, internal notes) in public attributes.
- The website loads data through the API and never keeps its own copy. Discover the API path from `/.well-known/world.json`; do not hardcode it. Treat pagination cursors as opaque.
- Keep the list/search view working as the accessible path through the world, even when the main view is a map, canvas or 3D scene.
- Add a framework or build step (for example Vite) only if the experience needs one. If you do, serve its build output from `src/app.ts` and proxy `/.well-known` and `/api` to this server in development.
- Do not add a database, authentication, Docker or cloud services unless the brief requires them.

## Check your work

```sh
npm run typecheck
npm test            # conformance, data integrity and website smoke tests
                    # (add assertLevel2Conformance and a race test for a Level 2 world)
npm run dev         # then open http://localhost:8787
```

`WORLD_URL` defaults to `http://localhost:$PORT`, so discovery always matches the port you run on.

## Deploy

1. Run `npm ci`, `npm run build` and `npm test` in CI.
2. Start the compiled service with `node dist/src/server.js`.
3. Set `HOST=0.0.0.0`, `PORT` to the platform-assigned port, and `WORLD_URL` to the public HTTPS origin, with no path.
4. Route all paths to this process: the website, `/.well-known/world.json` and `/api/world/v0/*`.
5. Terminate TLS at the platform or reverse proxy and health-check `/.well-known/world.json`.
6. For multiple instances, pass a shared `rateLimiter` to `defineWorld`.

Do not commit `.env`, credentials, access tokens or production secrets. This starter requires none.
