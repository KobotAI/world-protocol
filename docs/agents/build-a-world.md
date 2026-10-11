# Build a complete world with WorldDevKit

You are the coding agent responsible for designing, implementing, running, and validating a complete World Protocol Level 1 world. Treat the user’s request as the product brief. Work in the current repository unless the user asks you to create a new project.

Do not return a tutorial, implementation plan, or protocol demo. Make the code changes and deliver the working product.

## Your mission

Build the world people will actually visit, not only the API that describes it.

The finished result must combine:

1. A distinctive, public, browsable product experience for the intended audience.
2. A World Protocol Level 1 interface exposing the same entities through discovery and list/get routes.
3. A credential-free demo mode with coherent representative content.
4. A tested Node.js 20+ implementation that starts locally with documented commands.

Protocol conformance is required, but it is only the interoperability floor. A server that returns conformant JSON without a usable world interface is incomplete.

## Interpret the product brief

Before editing code, infer and state concise working decisions for:

- The audience and their primary goal.
- The world’s public entity types and relationships.
- The core exploration journey.
- The visual and interaction metaphor best suited to the domain.
- The smallest architecture that can deliver the experience well.

Make reasonable product decisions when details are missing. Ask a question only when a missing answer would materially change the product or create an irreversible risk. Do not block on routine choices such as layout, typography, sample content, or component structure.

A world does not have to be a literal globe or a 3D game. Choose the representation that makes its entities feel explorable: a geographic map, 2D or 3D scene, graph, timeline, catalog, spatial directory, constellation, neighborhood, archive, or another domain-specific model. Do not default to a generic SaaS dashboard.

## Start or integrate

If there is no WorldDevKit project yet, run:

```sh
npm create worlddevkit@latest my-world
cd my-world
npm install
```

If you are already inside an application, preserve its framework, package manager, design system, conventions, and existing user flows. Integrate the public `@worlddevkit/*` packages instead of replacing the application architecture.

The generated starter is deliberately backend-minimal. You may add the smallest appropriate UI framework and rendering dependencies needed for the requested world. Do not add a database, authentication system, Docker, or cloud-specific infrastructure unless the product brief requires it.

Use only public WorldDevKit packages:

- `@worlddevkit/spec` for protocol contracts and constants.
- `@worlddevkit/server` for the Fetch-compatible Level 1 handler.
- `@worlddevkit/client` for discovery and typed public reads.
- `@worlddevkit/testing` for Level 1 conformance.
- `@worlddevkit/core` for framework-neutral entities and money values.
- `@worlddevkit/geo` for privacy-safe public location projection.

## Product requirements

Deliver all of the following unless the user explicitly narrows the scope to backend-only work:

### Entry and exploration

- A clear entry state that communicates what the world is and offers an immediate primary action.
- A polished explore surface with domain-specific visual direction and interaction.
- Navigation that keeps visitors oriented as they move between overview and detail.
- Search, filtering, grouping, or discovery controls appropriate to the entity model.
- Useful detail views that expose attributes, relationships, and available actions.
- Coherent representative content instead of lorem ipsum, anonymous cards, or placeholder labels.

### Quality and accessibility

- Responsive behavior across desktop and mobile widths.
- Keyboard-usable controls, visible focus, semantic structure, sufficient contrast, and reduced-motion handling where applicable.
- An accessible list-based exploration path when the primary experience is visual, geographic, spatial, canvas-based, or 3D.
- Designed loading, empty, not-found, degraded, and failure states.
- No generic AI gradients, interchangeable dashboard cards, or raw JSON as the primary interface.

### Shared data model

The product interface and World Protocol routes must use the same source of truth. Do not create a visual mock whose content diverges from the entities exposed by the Level 1 API.

Keep the data layer replaceable. A credential-free in-memory or file-backed demo source is acceptable and preferred initially. Put persistence or upstream integrations behind the same `list` and `get` boundary.

## Protocol contract

Keep the wire protocol at `world/0.1` and conform to Level 1.

Serve discovery at:

```text
GET /.well-known/world.json
```

The discovery document must include:

- `protocol`
- A canonical world `id`
- A meaningful `name` and `description`
- `endpoints.api`
- Every public `entityTypes` value
- `wp:discover` in `actions`

Serve the API under the discovered endpoint, normally:

```text
GET  /api/world/v0
GET  /api/world/v0/entities/{type}
GET  /api/world/v0/entities/{type}/{id}
POST /api/world/v0/actions/wp%3Adiscover
```

Every entity must preserve this envelope:

```ts
{
  ref: { world, type, id },
  version,
  updatedAt,
  visibility: 'public',
  attributes,
  relationships,
  capabilities,
}
```

Rules:

- Keep `ref.world` consistent with `discovery.id`.
- Advertise every returned type in `discovery.entityTypes`.
- Use stable opaque entity IDs.
- Increment `version` when observable entity data changes.
- Return `null` when `source.get(type, id)` cannot find an entity.
- Treat pagination cursors as opaque.
- Discover the API endpoint; clients must not hardcode it.
- Preserve `wp:discover` behavior.
- Never expose private coordinates, credentials, secrets, or non-public source fields.

Use `WORLD_URL` as the production public HTTPS origin. Never advertise `localhost`, `0.0.0.0`, a private IP, or a container hostname in production discovery.

## Implementation sequence

Execute this sequence rather than only describing it:

1. Inspect the repository, existing instructions, package scripts, and current product structure.
2. Define the audience, entity model, core journey, visual metaphor, and implementation approach.
3. Create or integrate the WorldDevKit data model.
4. Rename and describe the world based on the actual product.
5. Add coherent representative entities and stable IDs.
6. Implement `source.list(type)` and `source.get(type, id)`.
7. Connect the protocol routes and the product interface to the same source.
8. Build the entry, explore, search/list, and entity-detail experiences.
9. Add responsive, accessible, loading, empty, not-found, and failure behavior.
10. Add or update conformance tests and tests for the primary product journey.
11. Run the product and inspect the real rendered result. Fix obvious visual, interaction, and runtime defects.
12. Run typechecking and tests. Report exact commands and results.

Keep the generated Node adapter in `src/server.ts` unless the chosen application architecture requires integration changes. Preserve discovery and API behavior if you change it.

## Required validation

At minimum, run:

```sh
npm run typecheck
npm test
npm run dev
```

While the app is running, verify:

```sh
curl http://localhost:8787/.well-known/world.json
curl 'http://localhost:8787/api/world/v0/entities/<encoded-entity-type>'
```

Also verify the primary visitor journey in the rendered interface, including one entity detail path and the accessible list/search path. Do not claim a command passed unless you actually ran it.

For deployment, configure:

```text
HOST=0.0.0.0
PORT=<platform-provided port>
WORLD_URL=https://your-world.example
```

Route both `/.well-known/world.json` and `/api/world/v0/*` to the application, then verify discovery and public reads against the deployed HTTPS origin.

## Definition of done

You are done only when:

- A visitor can understand and explore the world without seeing protocol internals.
- The experience has a deliberate product identity suited to its domain.
- The primary journey, entity details, and accessible alternative work.
- The UI and Level 1 API expose the same public entities.
- The world runs locally without credentials, a database, or Docker unless explicitly required.
- Discovery, entity list/get, pagination, and `wp:discover` remain conformant.
- Typechecking and tests pass.
- You report what you changed, what you validated, and any real remaining limitations.

Do not stop at scaffolding. Do not hand the user a list of steps you could perform. Implement and validate the complete world.