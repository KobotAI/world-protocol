# Quickstart

Run a complete, local World Protocol server and query it with WorldDevKit. No account, API key, database or Docker is required.

## Requirements

* Node.js 20 or newer
* pnpm 10.17.1

## Run the starter world

```sh
git clone https://github.com/KobotAI/world-protocol.git
cd world-protocol
corepack enable
pnpm install --frozen-lockfile
pnpm quickstart
```

The world is now available at `http://localhost:8787`. In another terminal, run the client:

```sh
pnpm --dir examples/client-node quickstart
```

You should see the starter places and an opaque pagination cursor.

## Make it yours

The starter has only three files that matter:

| File | Change |
|---|---|
| `examples/minimal-world/src/world.js` | World metadata, entities and data-source methods |
| `examples/minimal-world/src/server.js` | Node HTTP adapter; usually leave this alone |
| `examples/minimal-world/test/conformance.test.js` | Level 1 compatibility test |

Start by changing the world name and the `places` array in `src/world.js`. Keep entity IDs stable once clients can see them.

## Test it

```sh
pnpm --dir examples/minimal-world test
```

The test runs fully in-process and needs no open port.

## Deploy it

The starter already reads `PORT`, `HOST` and `WORLD_URL`, so it runs on any Node.js 20 host:

```text
Install command: pnpm install --frozen-lockfile && pnpm build
Start command: pnpm --dir examples/minimal-world start
Environment: HOST=0.0.0.0, WORLD_URL=https://your-world.example
```

Your host must route both `/.well-known/world.json` and `/api/world/v0/*` to the process. See [Deploy a world](../guides/deploy-a-world.md) for the production checklist.

## Using an AI coding agent

Open the repository in Claude Code, Zed, Codex or another coding agent and give it this prompt:

```text
Read AGENTS.md and docs/agents/build-a-world.md. Turn examples/minimal-world into a world named <name>. Use only public @worlddevkit APIs, keep discovery and conformance working, and run pnpm test plus pnpm typecheck before finishing.
```

The repository also publishes `llms.txt` and `llms-full.txt` as compact machine-readable context.
