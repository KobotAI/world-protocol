# Examples

| Example                                       | Purpose                                                         |
| --------------------------------------------- | --------------------------------------------------------------- |
| [`minimal-world`](../examples/minimal-world/) | Serve an in-memory Level 1 world and test its conformance       |
| [`client-node`](../examples/client-node/)     | Discover and query the local starter or your own deployed world |

Run both examples from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm quickstart
```

In another terminal:

```sh
pnpm --dir examples/client-node quickstart
```

Both examples use workspace packages during repository development. Published-package installation is independently verified from packed artifacts by `scripts/worldkit/verify-consumer.mjs` in CI.
