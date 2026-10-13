# Test conformance

`@worlddevkit/testing` checks that an implementation satisfies World Protocol Level 1 discovery, entity-read, pagination, action, CORS, visibility and error contracts.

```sh
npm install --save-dev @worlddevkit/testing
```

```js
import { assertLevel1Conformance } from '@worlddevkit/testing'

const report = await assertLevel1Conformance({
  world: 'https://your-world.example',
})

console.log(report.checks)
```

`assertLevel1Conformance` throws when any check fails and returns the complete report when all checks pass.

A generated starter tests without opening a network port:

```sh
npm test
```

To test a deployed world from this repository, manually run the **Remote Level 1 conformance** GitHub workflow and supply its public origin. The workflow has no built-in production URL.
