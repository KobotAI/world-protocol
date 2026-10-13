# My World

A World Protocol Level 1 world built with WorldDevKit: a website for exploring its places, and a public read-only API serving the same data. No credentials, database or Docker needed.

## Start

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:8787 to explore the world. To use another port, set `PORT`; discovery follows it automatically. Copy `.env.example` to `.env` and export its variables if you need different values.

The same entities are available to other software through the World Protocol:

```sh
curl http://localhost:8787/.well-known/world.json
curl 'http://localhost:8787/api/world/v0/entities/wp%3Aplace'
curl -X POST http://localhost:8787/api/world/v0/actions/wp%3Adiscover \
  -H 'content-type: application/json' \
  -d '{"input":{"types":["wp:place"],"text":"garden"}}'
```

## Commands

```sh
npm run dev          # Run the server in watch mode
npm run build        # Compile to dist/
npm run typecheck    # Strict TypeScript check without emitting
npm test             # Build, then run conformance, data and website tests
npm run conformance  # Build and run only the Level 1 conformance test
```

## Customize

- `src/data.ts`: the world's entities.
- `src/world.ts`: its name, description and public URL.
- `public/`: the website.

See [`AGENTS.md`](./AGENTS.md) for the full guide, including what Level 1 can and cannot do and how to deploy.
