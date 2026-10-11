# Quickstart

Run a complete, local World Protocol server and query it with WorldDevKit. No account, API key, database or Docker is required.

## Requirements

* Node.js 20 or newer
* npm 10 or newer

## Create a world

```sh
npm create worlddevkit@latest my-world
cd my-world
npm install
npm run dev
```

The world is now available at `http://localhost:8787`. Query discovery and the starter places from another terminal:

```sh
curl http://localhost:8787/.well-known/world.json
curl 'http://localhost:8787/api/world/v0/entities/wp%3Aplace'
```

The generated project is TypeScript, credential-free, database-free, Docker-free, and deployable to any Node.js 20+ host.

## Make it yours

The starter has only three files that matter:

| File | Change |
|---|---|
| `src/world.ts` | World metadata, entities and data-source methods |
| `src/server.ts` | Node HTTP adapter; usually leave this alone |
| `test/conformance.test.ts` | Level 1 compatibility tests |

Start by changing the world name and the `places` array in `src/world.ts`. Keep entity IDs stable once clients can see them.

## Test it

```sh
npm run typecheck
npm test
```

The tests run fully in-process and need no open port.

## Deploy it

The starter already reads `PORT`, `HOST` and `WORLD_URL`, so it runs on any Node.js 20 host:

```text
Install command: npm ci
Build command: npm run build
Start command: node dist/src/server.js
Environment: HOST=0.0.0.0, WORLD_URL=https://your-world.example
```

Your host must route both `/.well-known/world.json` and `/api/world/v0/*` to the process. See [Deploy a world](../guides/deploy-a-world.md) for the production checklist.

## Using an AI coding agent

Open the generated project in Claude Code, Zed, ChatGPT, Codex, or another coding agent and give it this prompt:

```text
Read AGENTS.md. Turn this starter into a world named <name>. Use only public @worlddevkit APIs, keep discovery and Level 1 conformance working, and run npm run typecheck plus npm test before finishing.
```

The repository also publishes `llms.txt` and `llms-full.txt` as compact machine-readable context.

## Contributing to WorldDevKit

To change the protocol packages or reference examples instead of creating a world:

```sh
git clone https://github.com/KobotAI/world-protocol.git
cd world-protocol
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```
