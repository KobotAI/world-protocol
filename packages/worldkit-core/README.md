# `@worlddevkit/core`

Core World Protocol primitives for projecting application records into safe world entities and enforcing money and settlement invariants.

## Install

```sh
npm install @worlddevkit/core
```

## Entity projection

```ts
import { defineEntityProjection, project } from '@worlddevkit/core'

const storeProjection = defineEntityProjection({
  type: 'wp:store',
  id: (store: { id: string }) => store.id,
  version: () => 1,
  updatedAt: () => new Date(),
  visibility: () => 'public' as const,
  attributes: (store: { id: string; name: string }) => ({ name: store.name }),
})

const entity = project(storeProjection, { id: 'one', name: 'One Store' }, {
  world: 'https://world.example',
  caller: { kind: 'anonymous', scopes: [] },
})
```

`project` is the explicit boundary between private application records and protocol entities. It applies visibility and emits only the attributes selected by the projection.

## Money invariants

```ts
import { assertCanPay, money } from '@worlddevkit/core'

const price = money(750_000, 'NGN', 'fiat')
assertCanPay(
  { reality: 'real', price },
  { currency: 'NGN', settlement: 'fiat' },
  'world.example',
)
```

Amounts are integer minor units. Real offers settle in fiat; virtual offers settle only in currency issued by the selling world.

## License

Apache-2.0
