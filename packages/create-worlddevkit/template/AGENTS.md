# World development guide

## Deliver a world, not an API demo

Unless the user explicitly asks for backend-only work, the finished product must include a public, browsable experience for the world's actual audience. Protocol conformance is the foundation, not the final interface.

- Start by identifying the audience, public entities, core journey, and a visual metaphor suited to the domain.
- Build an intentional explore surface and entity detail experience. A map, 2D/3D scene, graph, timeline, catalog, or another domain-specific representation is preferable to a generic dashboard or JSON viewer.
- Include an accessible list/search path, responsive layouts, keyboard-usable controls, and designed loading, empty, and error states.
- Use one source of truth for the interface and World Protocol routes. Do not create a visual mock backed by data that differs from the public entities.
- Keep representative demo content and a credential-free local mode so `npm install` and `npm run dev` produce a useful world immediately.
- Preserve the current stack when integrating into an existing product. In this generated starter, add only the UI and rendering dependencies justified by the intended experience.
- Do not stop after scaffolding routes or returning conformant JSON. Run the product and verify the primary exploration journey end to end.

## Extend the protocol surface

- Define additional protocol entities in `src/world.ts` as `EntityEnvelope` values.
- Add each supported type to `discovery.entityTypes`, then implement it in both `source.list` and `source.get`.
- Keep entity IDs stable, increment `version` when an entity changes, and emit an ISO 8601 `updatedAt` value.
- Replace the in-memory `EntitySource` with your own adapter for persistence or upstream APIs. Keep storage concerns behind the `list` and `get` methods.
- Add actions to `discovery.actions` only when their routes are implemented.
- Run `npm run typecheck` and `npm run conformance` after protocol changes.

## Deploy

1. Run `npm ci`, `npm run build`, and `npm test` in CI.
2. Start the compiled service with `node dist/src/server.js`.
3. Set `HOST=0.0.0.0`, `PORT` to the platform-assigned port, and `WORLD_URL` to the public HTTPS origin. Do not include `/api/world/v0` in `WORLD_URL`.
4. Route both `/.well-known/world.json` and `/api/world/v0/*` to this process.
5. Terminate TLS at the platform or reverse proxy and configure health checks against `/.well-known/world.json`.
6. For multiple instances, replace the process-local rate limiter with a shared `RateLimiter` implementation.

Do not commit `.env`, credentials, access tokens, or production secrets. This starter requires none.
