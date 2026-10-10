# `@worlddevkit/geo`

Privacy-preserving geospatial primitives for World Protocol implementations. Locations are deterministically reduced to H3 cell centres instead of exposing raw coordinates or using reversible random jitter.

## Install

```sh
npm install @worlddevkit/geo
```

## Publish a location at controlled precision

```ts
import { effectivePrecision, toPublicLocation } from '@worlddevkit/geo'

const precision = effectivePrecision('exact', 'neighbourhood')
const location = toPublicLocation(
  { lat: 6.5244, lng: 3.3792 },
  precision,
  'Lagos',
)
```

`effectivePrecision` chooses the coarsest applicable participant, world, or grant ceiling. `toPublicLocation` returns a deterministic public representation.

## Coarse distance

```ts
import { distanceBucket } from '@worlddevkit/geo'

const distance = distanceBucket(originCell, destinationCell)
// nearby | in_your_area | across_the_city | far
```

Distance buckets avoid exposing metre-level distances that could help triangulate private locations.

## License

Apache-2.0
