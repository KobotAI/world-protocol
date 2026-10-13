# `create-worlddevkit`

Dependency-free initializer for a credential-free, database-free, Docker-free World Protocol Level 1 world: a website and its API in one TypeScript project.

## Usage

```sh
npm create worlddevkit@latest my-world
cd my-world
npm install
npm run dev
```

Or invoke the executable directly:

```sh
create-worlddevkit my-world
```

The generated starter depends on the `@worlddevkit/server`, `@worlddevkit/spec`, `@worlddevkit/client`, and `@worlddevkit/testing` packages released alongside this CLI. It runs immediately and includes:

- a website at `/` (plain HTML, CSS and JavaScript in `public/`) with search, filtering and entity detail pages, reading its data through the API;
- `/.well-known/world.json` and the Level 1 API under `/api/world/v0`;
- sample `wp:place` entities in `src/data.ts`, the single source of truth for both;
- conformance, data-integrity and website tests, and an `AGENTS.md` guide for coding agents.

## Options

```text
-h, --help       Show help
-v, --version    Show the package version
```

The target may be new or an existing empty directory. Unsafe package names, traversal segments, symlinks, files, and non-empty directories are rejected without overwriting their contents.

## Development

```sh
npm test
```

Tests use only Node.js built-ins and do not install packages or access the network.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
