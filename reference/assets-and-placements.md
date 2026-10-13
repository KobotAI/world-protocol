# Assets and placements

Worlds can share things with each other. A **publisher** world offers its products or game items as **assets**. A **host** world shows other worlds' assets as **placements**, with the owner's approval, up to a limit it sets. Both stay in sync: when the publisher changes a price or withdraws an item, every host updates.

## Assets (publisher)

A world publishes `wp:asset` entities and lists `wp:assets` in its discovery `extensions`.

```json
{
  "ref": { "world": "https://shop.example", "type": "wp:asset", "id": "stove" },
  "attributes": {
    "name": "Eleven Gas Stove",
    "description": "Two burners, barely used.",
    "image": { "url": "https://shop.example/img/stove.png", "alt": "A two-burner gas stove", "width": 512, "height": 512 },
    "model": { "url": "https://shop.example/models/stove.glb", "format": "glb", "bytes": 480000 },
    "price": { "amount": 1800000, "currency": "NGN" },
    "placement": { "hosts": "any" }
  },
  "links": { "web": "https://shop.example/p/stove" }
}
```

| Field | Rules |
| --- | --- |
| `name` | Required, up to 80 characters. |
| `image` | Required. `url` over https; `alt` text describing the picture; optional `width`/`height` up to 8192. |
| `model` | Optional 3D model: `glb` only, at most 10 MB. |
| `price` | Optional. `amount` in the currency's minor unit (kobo, cents), `currency` code. |
| `placement.hosts` | `"any"` (default) or a list of world origins allowed to show it. |
| `links.web` | Required. The page where people see or buy the real thing. |

Publishing an asset is the publisher's consent to be shown. Removing it, or making it non-public, withdraws it everywhere.

## Placements (host)

A host lists `wp:placements` in `extensions`, advertises the actions below, and needs an owner (admin) token.

| Action | Who | Input | Does |
| --- | --- | --- | --- |
| `wp:offer` | Anyone with a session | `{ "asset": { "world": "https://shop.example", "id": "stove" } }` | Fetches and checks the asset from its own world, then records a private offer (or places it at once if the host auto-accepts and has room). |
| `wp:accept` | Owner | `{ "placement": "<id>", "slot": "stall-3" }` | Shows the offer. Refused with `host_full` at the limit. `slot` is a free label the host's UI understands. |
| `wp:remove` | Owner | `{ "placement": "<id>" }` | Removes an offer or placement. |
| `wp:placements` | Owner | `{}` | Lists every offer and placement, including private ones. |

A placed asset is a public `wp:placement` entity in the host world:

```json
{
  "ref": { "world": "https://game.example", "type": "wp:placement", "id": "pl-1k2j3h-stove" },
  "attributes": {
    "name": "Eleven Gas Stove",
    "status": "placed",
    "slot": "stall-3",
    "asset": { "name": "…", "description": "…", "image": { … }, "model": null, "web": "…", "price": { … } },
    "source": { "world": "https://shop.example", "worldName": "Yaba Shop", "type": "wp:asset", "id": "stove", "version": 3, "updatedAt": "…" }
  },
  "relationships": [{ "rel": "shows", "target": { "world": "https://shop.example", "type": "wp:asset", "id": "stove" } }],
  "links": { "web": "https://shop.example/p/stove" },
  "sponsorship": { "sponsor": { "name": "Yaba Shop", "ref": { … } }, "label": "presented_by" }
}
```

Hosts must show the `sponsorship` label ("Presented by Yaba Shop") wherever they show a placement.

## Safety rules for hosts

The reference server enforces these; other implementations must too.

* Fetch other worlds only over https, never from private, loopback or link-local addresses, and never follow redirects. (Local development worlds may use `http://localhost`.)
* Check the source world's discovery: it must identify itself at its own origin and advertise `wp:asset`.
* Cap responses (256 KB), time out (5 s), length-limit all text and strip control characters.
* Show asset text as text, never as HTML. Open `links.web` in a new tab with `rel="noopener noreferrer"`.
* Load images and models only from the URLs in the sanitized snapshot, and fall back gracefully when they fail.
* Fetch slowly outside the action queue, so a slow publisher never delays players.

DNS can still resolve a public hostname to a private address. Hosts on networks with sensitive internal services should also block private ranges at the network level.

## Staying in sync

Hosts re-check every placement on a timer, and follow each Level 2 source's events stream to react within a second. A changed asset updates the placement (a new `version`, and `entity.changed` on the host's own stream). A withdrawn or no-longer-allowed asset removes it (`entity.removed`). A source that is temporarily unreachable keeps its placements.

## Build it

```ts
// Publisher
import { defineAsset, defineWorld } from '@worlddevkit/server'
defineWorld({ …, entities: [defineAsset({ id: 'stove', name: 'Eleven Gas Stove', image: { url, alt }, web, price })] })

// Host
const world = defineWorld({ …, adminToken: process.env.WORLD_ADMIN_TOKEN, placements: { max: 5 } })
world.placements!.startSync()   // in src/server.ts
```

Check both with `runAssetConformance({ world })` from `@worlddevkit/testing`, alongside the Level 1 and Level 2 suites.
