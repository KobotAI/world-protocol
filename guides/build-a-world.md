# Build a world with a coding agent

Give this page to your coding agent (Claude Code, Codex, Cursor or similar) together with a short brief, for example:

```text
Build a world with WorldDevKit, following https://docs.kobotai.co/world/guides/build-a-world.md.

Brief: A guide to Lagos street-food vendors for visitors. Vendors, dishes and neighbourhoods.
Visitors browse by area on a map, filter by dish and price, and open a vendor to see its menu
and nearby vendors.
```

Everything below is written for the agent.

---

You are a coding agent. Build the world described in the brief as a working website that also serves the World Protocol Level 1 API. Write and run the code yourself. Do not hand back a plan, a tutorial or a protocol demo.

## What you are building, and what you are not

A **world** is a public website for exploring a set of entities (places, people, items, events), plus a read-only API that exposes the same entities to other software.

World Protocol Level 1 is **read-only**: discovery, list, get, and `wp:discover` search. It cannot record anything a visitor does, such as moves, scores, votes or purchases.

- If the brief asks for a game or other visitor-changed state, keep that state in the browser, or in your own routes outside `/api/world/v0`, and say in your final report that it is not part of the protocol. Never advertise an action you have not implemented.
- If the brief does not mention interactivity, build an exploration experience, not a game.

## Scope

Stay inside this budget unless the brief asks for more:

- 2–4 entity types and 15–40 entities in total, with real relationships between them.
- One primary explore view designed for the domain (map, graph, timeline, scene, catalog, or similar), one list/search view, and one entity detail view.
- No database, authentication, Docker or cloud services. Demo data lives in the repository.

Make routine decisions yourself: layout, fonts, sample content, component structure. Ask only if the brief leaves out something that would change the whole product, such as who the audience is.

## Start

If there is no WorldDevKit project yet:

```sh
npm create worlddevkit@latest my-world
cd my-world
npm install
npm test
```

The starter already runs end to end: a website at `/`, the API, sample entities and passing tests. Read its `AGENTS.md`. You will mainly change three places:

| File | What it is |
| --- | --- |
| `src/data.ts` | Every entity. The single source of truth for the API and the website. |
| `src/world.ts` | World name, description and public URL, via `defineWorld`. |
| `public/` | The website: `index.html`, `app.js`, `styles.css`. It reads data only through the API. |

If you are inside an existing application instead, keep its framework, package manager and conventions. Add `@worlddevkit/server`, use `defineWorld` for the protocol, and route `/.well-known/world.json` and `/api/world/v0/*` to `world.fetch`.

## Work in three phases

Finish each phase, with its checks passing, before you start the next. If you run out of time or context, a finished earlier phase is worth more than a half-finished later one.

### Phase 1: Data and API

1. In `src/world.ts`, rename the world and write a `description` from the brief.
2. In `src/data.ts`, replace the sample places with the world's entities:
   - Use readable, stable IDs (`vendor-iya-basira`). Never change an ID after publishing it.
   - Give entities `name`, `description` and `category` attributes where they make sense. The built-in `wp:discover` search matches `name`, `description`, `tagline` and `category`; pass `searchFields` to `defineWorld` to search other attributes.
   - Connect entities with `relationships`, for example `{ rel: 'serves', target: { type: 'wp:dish', id: 'dish-amala' } }`. `defineWorld` throws at startup if a target does not exist.
   - Do not include private data: home addresses, private phone numbers, credentials, internal notes. Only `public` entities are served.
3. Run:

   ```sh
   npm run typecheck
   npm test
   ```

   Both must pass before Phase 2. The tests check Level 1 conformance, that every entity is served, and that every relationship resolves.

### Phase 2: The website

Turn the starter website in `public/` into the experience the brief describes:

- **Entry:** say what this world is and offer one obvious first action.
- **Explore:** the primary view, designed for this domain. Avoid generic dashboard cards, stock gradients and raw JSON.
- **List and search:** keep the starter's list/search view working. It is the keyboard and screen-reader path through the world, and is required whenever the primary view is a map, canvas or 3D scene.
- **Detail:** each entity's attributes and links to related entities, with a URL of its own.
- **States:** loading, empty search, not found and API error. The starter has all four; keep them working.
- **Quality:** works from 360px phone width to desktop, visible focus, sufficient contrast, and `prefers-reduced-motion` respected.

Rules for the website:

- Load data only through the API. Never keep a second copy of the entities in the front end.
- Find the API through `/.well-known/world.json`; never hardcode it. Treat pagination cursors as opaque.
- Plain HTML, CSS and JavaScript is the default. Add a framework or build step (for example Vite for a 3D scene) only if the experience needs one. If you do, serve its build output from `src/app.ts` and proxy `/.well-known` and `/api` to the world server during development.
- You may load a map or 3D library from a CDN or npm if the explore view needs it.

Check, with `npm run dev` running:

```sh
curl -s http://localhost:8787/ | head -5                     # your HTML, not a 404
curl -s http://localhost:8787/.well-known/world.json
curl -s 'http://localhost:8787/api/world/v0/entities/<url-encoded-type>?limit=2'
```

If you can drive a browser (Playwright, a browser tool or screenshots), open the site, go from the entry screen to an entity's detail page, follow a related link, come back through search, and fix what you see. If you cannot, say so in your report. Never claim a visual check you did not do.

### Phase 3: Tests and polish

1. Extend `test/site.test.ts` to cover your main journey: for example, that every entity type the website links to is served, and that any new pages or assets load.
2. Fix any errors in the browser console or the server log.
3. Run `npm run typecheck` and `npm test` again.

## Rules that must not break

- Discovery stays at `GET /.well-known/world.json` with protocol `world/0.1`. `defineWorld` builds it: do not hand-edit its fields.
- The Level 1 routes stay under the discovered API endpoint, normally `/api/world/v0`.
- `WORLD_URL` is the world's public origin with no path. Locally it defaults to `http://localhost:$PORT`. In production it is the HTTPS origin; never advertise `localhost`, `0.0.0.0`, a private IP or a container hostname.

## Final report

End with a short report in this shape:

1. **What I built:** audience, entity types and counts, the explore view, and how to run it.
2. **Files changed:** a list.
3. **Checks run:** each command and its actual result. List only commands you ran.
4. **Not verified:** anything you could not check, such as visual review without a browser.
5. **Limits:** anything in the brief that Level 1 cannot do, and where you built it instead.

## Deploy (only if asked)

1. Set `HOST=0.0.0.0`, `PORT` to the platform's port, and `WORLD_URL` to the public HTTPS origin.
2. Build with `npm run build` and start with `node dist/src/server.js`.
3. Route every path to the app: the website, `/.well-known/world.json` and `/api/world/v0/*`.
4. Repeat the Phase 2 curl checks against the HTTPS origin, then run the remote conformance workflow or `assertLevel1Conformance({ world: '<https origin>' })`.
