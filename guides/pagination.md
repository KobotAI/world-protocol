# Pagination

Entity collections use opaque cursor pagination. Pass the returned `nextCursor` back unchanged; never decode, modify or construct cursors.

## Iterate pages

```js
for await (const page of client.paginateEntities('wp:store', { limit: 50 })) {
  console.log(page.entities)
}
```

## Iterate entities

```js
for await (const store of client.entities('wp:store', { limit: 50 })) {
  console.log(store.ref.id, store.attributes.name)
}
```

## Manual pagination

```js
let cursor = null

do {
  const page = await client.listEntities('wp:store', {
    cursor,
    limit: 50,
  })

  await consume(page.entities)
  cursor = page.nextCursor
} while (cursor !== null)
```

A `null` `nextCursor` means the collection is exhausted. The client iterators also reject a server that repeats a cursor, preventing an accidental infinite loop.
