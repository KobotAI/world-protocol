# Level 2 API

Level 1 lets anyone read a world. Level 2 lets people change it: claim a plot, make a move, place an order. It adds **actions**, **sessions** and a live **events** stream on top of Level 1, which stays exactly as it is. A Level 2 world must also pass Level 1 conformance.

## Discovery

A Level 2 world advertises:

```json
{
  "protocol": "world/0.1",
  "extensions": ["wp:level-2"],
  "endpoints": {
    "api": "https://plots.example/api/world/v0",
    "events": "https://plots.example/api/world/v0/events"
  },
  "actions": ["wp:discover", "wp:session", "game:join", "game:claim"],
  "events": ["entity.changed", "entity.removed", "game:round_started"]
}
```

* `wp:level-2` in `extensions` is how clients know the world accepts actions.
* `actions` lists every action. World actions are namespaced (`game:claim`, not `claim`).
* `events` lists every event the stream can carry.

## Sessions

```
POST {api}/actions/wp%3Asession
→ 200 { "output": { "token": "…", "caller": "c_…", "expiresAt": "2026-10-14T…Z" }, "changed": [], "removed": [] }
```

Send the token as `Authorization: Bearer <token>` on later actions. The world identifies the caller by it. Actions require a session unless the world says otherwise. A session is anonymous: it says "the same caller as before", not who the person is.

## Actions

```
POST {api}/actions/{name}
Content-Type: application/json
Authorization: Bearer <token>

{
  "input": { … },                          // always a JSON object
  "target": { "type": "game:plot", "id": "p1" },   // optional: the entity acted on
  "ifVersion": 3                           // optional: only if target is still at version 3
}
```

Success:

```json
{ "output": { "claimed": "p1" }, "changed": [ /* entity envelopes at new versions */ ], "removed": [ /* refs */ ] }
```

Rules:

* **Capabilities gate actions.** When a request names a `target`, the target's `capabilities` must include the action. An entity's capabilities are the honest list of what can be done to it right now. A claimed plot drops `game:claim`.
* **Versions prevent lost updates.** Every change increments the entity's `version`. Send the version you last saw as `ifVersion`. If someone changed it first, you get `409 version_conflict` with the current entity in `details.current`.
* **Actions are atomic.** The reference server runs one action at a time per world, so a handler can read, decide and write without another action interleaving.
* **Errors are protocol errors** (`{ "code", "message", "details"? }`), never cached:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_input`, `invalid_target`, `invalid_if_version` | The request is malformed. |
| 401 | `unauthenticated` | The action needs a session. |
| 403 | `not_allowed` | The target's capabilities do not include this action right now. |
| 404 | `unknown_action`, `entity_not_found` | No such action, or no such public target. |
| 409 | `version_conflict` | The target changed since `ifVersion`. `details.current` holds it. |
| 422 | world-defined | The world refused by its own rules, for example `round_closed`. |
| 429 | `rate_limited` | Too many actions. Respect `Retry-After`. |

## Events

```
GET {api}/events
Accept: text/event-stream
```

A [server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream. Each event has an increasing `id`:

```
id: 41
event: entity.changed
data: {"entity":{"ref":{…},"version":4,…}}

id: 42
event: game:round_started
data: {"round":7,"clue":"Under ₦20,000"}
```

* `entity.changed` carries the full public entity after a change, including newly created ones.
* `entity.removed` carries `{ "ref": … }` when an entity is deleted or stops being public.
* World-defined events carry whatever the world declares.
* Reconnect with `Last-Event-ID` to receive what you missed. If the world no longer has it, you get a `reset` event: refetch the state you show.
* Non-public entities never appear on the stream.

In a browser, `new EventSource(discovery.endpoints.events)` handles reconnection and `Last-Event-ID` for you.

## Build one

`defineWorld` builds all of this from an `actions` map. See [Build with a coding agent](../guides/build-a-world.md#level-2-worlds-people-can-change) and the [`@worlddevkit/server` README](../packages/worldkit-server/README.md).

Test it with both suites:

```ts
await assertLevel1Conformance({ world: world.discovery.id, fetch: world.fetch })
await assertLevel2Conformance({ world: world.discovery.id, fetch: world.fetch })
```
