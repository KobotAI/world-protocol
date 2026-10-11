# `create-worlddevkit`

Dependency-free initializer for a credential-free, database-free, Docker-free World Protocol Level 1 TypeScript server.

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

The generated starter uses the published `@worlddevkit/server`, `@worlddevkit/spec`, `@worlddevkit/client`, and `@worlddevkit/testing` packages at `^0.1.1`. It exposes `/.well-known/world.json`, the Level 1 API under `/api/world/v0`, and in-memory `wp:place` entities.

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
