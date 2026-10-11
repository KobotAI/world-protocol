# Level 1 API

World Protocol Level 1 defines discovery, entity reads and a discovery action. The repository includes an [OpenAPI 3.1 document](openapi.yaml) for GitBook, client generators and API tooling. The contracts in `@worlddevkit/spec` remain the protocol source of truth.

Examples below use the local starter at `http://localhost:8787`. Production clients should start from a world origin and discover its API endpoint.

## Discovery

```http
GET /.well-known/world.json
```

```sh
curl http://localhost:8787/.well-known/world.json
```

## List entities

```http
GET /api/world/v0/entities/{type}?limit=20&cursor={opaqueCursor}
```

```sh
curl --get 'http://localhost:8787/api/world/v0/entities/wp%3Aplace' \
  --data-urlencode 'limit=2' \
  --header 'accept: application/json'
```

## Get an entity

```http
GET /api/world/v0/entities/{type}/{id}
```

Both type and ID are URL path components and must be encoded.

## Discover entities

```http
POST /api/world/v0/actions/wp%3Adiscover
Content-Type: application/json

{
  "input": {
    "types": ["wp:place"],
    "text": "garden",
    "limit": 20
  }
}
```

## Errors

Non-success responses contain a stable `code` and human-readable `message`. SDK consumers receive these as `WorldHttpError` with `status`, `code`, `details` and `url`.

## Versioning

The current protocol is `world/0.1` and the Level 1 route is `/api/world/v0`. Do not substitute `/api/v1`; follow the discovery document.
