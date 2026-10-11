# Build a world with a coding agent

The generated TypeScript starter is intentionally small enough for a coding agent to change safely. It runs locally without credentials, a database, or Docker.

Create it before opening the directory in Claude Code, Zed, ChatGPT, Codex, or another coding agent:

```sh
npm create worlddevkit@latest my-world
cd my-world
npm install
```

## Deterministic workflow

Ask the agent to do these steps in order:

1. Read the generated `AGENTS.md` and this guide.
2. Use `src/world.ts` as the implementation.
3. Rename the world in `src/world.ts`.
4. Choose the public entity types and update `discovery.entityTypes`.
5. Replace the fixture entities while preserving the entity envelope: `ref`, `version`, `updatedAt`, `visibility`, `attributes`, `relationships`, and `capabilities`.
6. Implement `source.list(type)` and `source.get(type, id)`.
7. Leave the HTTP adapter in `src/server.ts` unchanged.
8. Preserve `/.well-known/world.json`, the advertised API endpoint, opaque pagination, and `wp:discover`.
9. Add or update conformance tests.
10. Run `npm run typecheck` and `npm test`.
11. Deploy with `WORLD_URL`, `HOST=0.0.0.0`, and the platform-provided `PORT`.
12. Run remote conformance against the public HTTPS origin.

Do not add persistence or authentication until the product requires them. First make the public read model correct and conformant.

## Copyable prompt

```text
Read AGENTS.md.

Turn this generated project into a World Protocol Level 1 world named "<WORLD NAME>" for "<PRODUCT DESCRIPTION>".

Requirements:
- Use only public @worlddevkit/* APIs.
- Keep GET /.well-known/world.json and /api/world/v0 working.
- Define these entity types: <ENTITY TYPES>.
- Replace the synthetic fixtures with representative public data.
- Implement source.list and source.get with stable entity IDs.
- Keep the existing Node server adapter unless a change is strictly required.
- Do not add a database, authentication, Docker, or cloud-specific code.
- Production discovery must use WORLD_URL; never advertise localhost, 0.0.0.0, or a container address in production.
- Add or update conformance tests.
- Run npm run typecheck and npm test and report exact results.
```

## Local verification

Start the world:

```sh
npm install
npm run dev
```

Query it from another terminal:

```sh
curl http://localhost:8787/.well-known/world.json
curl 'http://localhost:8787/api/world/v0/entities/wp%3Aplace'
```

## Deployment contract

Configure the Node host with:

```text
HOST=0.0.0.0
PORT=<provided by host>
WORLD_URL=https://your-world.example
```

Route both `/.well-known/world.json` and `/api/world/v0/*` to the process and terminate TLS at the platform or reverse proxy. Then verify:

```sh
node scripts/worldkit/check-live-level1.mjs https://your-world.example
```

See [Deploy a world](../guides/deploy-a-world.md) for the full checklist.