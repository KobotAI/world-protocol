export type JsonSchema = Readonly<Record<string, unknown>>

const draft = 'https://json-schema.org/draft/2020-12/schema'
const ids = {
  world: 'https://worldprotocol.dev/schemas/0.1/world-discovery.json',
  ref: 'https://worldprotocol.dev/schemas/0.1/entity-ref.json',
  entity: 'https://worldprotocol.dev/schemas/0.1/entity.json',
  collection: 'https://worldprotocol.dev/schemas/0.1/entity-collection.json',
  query: 'https://worldprotocol.dev/schemas/0.1/discover-query.json',
  result: 'https://worldprotocol.dev/schemas/0.1/discover-result.json',
  error: 'https://worldprotocol.dev/schemas/0.1/protocol-error.json',
} as const

const stringArray = { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true } as const
const entityProperties = {
  ref: { $ref: ids.ref },
  version: { type: 'integer', minimum: 0 },
  updatedAt: { type: 'string', format: 'date-time' },
  visibility: { enum: ['public', 'connections', 'private'] },
  attributes: { type: 'object' },
  location: { type: 'object' },
  relationships: {
    type: 'array',
    items: {
      type: 'object',
      required: ['rel', 'target'],
      properties: {
        rel: { type: 'string', minLength: 1 },
        target: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            world: { type: 'string', format: 'uri' },
            type: { type: 'string', minLength: 1 },
            id: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  capabilities: stringArray,
  links: { type: 'object', additionalProperties: { type: 'string', format: 'uri-reference' } },
  sponsorship: { type: 'object' },
  layer: { type: 'string', minLength: 1 },
} as const

export const worldDiscoveryDocumentSchema = {
  $schema: draft,
  $id: ids.world,
  title: 'World discovery document',
  type: 'object',
  required: ['protocol', 'id', 'name', 'endpoints', 'entityTypes'],
  properties: {
    protocol: { const: 'world/0.1' },
    id: { type: 'string', format: 'uri', pattern: '^https://' },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    endpoints: {
      type: 'object',
      required: ['api'],
      properties: {
        api: { type: 'string', format: 'uri' },
        events: { type: 'string', format: 'uri' },
        subscriptions: { type: 'string', format: 'uri' },
        authorization: { type: 'string', format: 'uri' },
        token: { type: 'string', format: 'uri' },
        jwks: { type: 'string', format: 'uri' },
        mcp: { type: 'string', format: 'uri' },
      },
      additionalProperties: { type: 'string', format: 'uri' },
    },
    entityTypes: stringArray,
    events: stringArray,
    actions: stringArray,
    scopes: stringArray,
    extensions: { type: 'array', items: { type: 'string', format: 'uri' }, uniqueItems: true },
    layers: stringArray,
    currencies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'settlement'],
        properties: {
          code: { type: 'string', minLength: 1 },
          settlement: { enum: ['fiat', 'virtual'] },
        },
        additionalProperties: false,
      },
      uniqueItems: true,
    },
  },
  additionalProperties: false,
} as const satisfies JsonSchema

export const entityRefSchema = {
  $schema: draft,
  $id: ids.ref,
  title: 'Entity reference',
  type: 'object',
  required: ['world', 'type', 'id'],
  properties: {
    world: { type: 'string', format: 'uri', pattern: '^https://' },
    type: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const satisfies JsonSchema

export const entityEnvelopeSchema = {
  $schema: draft,
  $id: ids.entity,
  title: 'Entity envelope',
  type: 'object',
  required: ['ref', 'version', 'updatedAt', 'visibility', 'attributes', 'relationships', 'capabilities'],
  properties: entityProperties,
  additionalProperties: false,
} as const satisfies JsonSchema

export const paginatedEntityCollectionSchema = {
  $schema: draft,
  $id: ids.collection,
  title: 'Paginated entity collection',
  type: 'object',
  required: ['entities', 'nextCursor'],
  properties: {
    entities: { type: 'array', items: { $ref: ids.entity } },
    nextCursor: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const satisfies JsonSchema

const moneyFilter = {
  type: 'object',
  required: ['amount', 'currency'],
  properties: {
    amount: { type: 'integer', minimum: 0 },
    currency: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const

export const discoverQuerySchema = {
  $schema: draft,
  $id: ids.query,
  title: 'Discover query',
  type: 'object',
  properties: {
    types: stringArray,
    text: { type: 'string' },
    category: { type: 'string', minLength: 1 },
    near: {
      type: 'object',
      required: ['cell'],
      properties: { cell: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
    radius: { enum: ['nearby', 'district', 'city'] },
    price: {
      type: 'object',
      properties: { min: moneyFilter, max: moneyFilter },
      minProperties: 1,
      additionalProperties: false,
    },
    layer: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const satisfies JsonSchema

export const discoverResultSchema = {
  $schema: draft,
  $id: ids.result,
  title: 'Discover result',
  type: 'object',
  required: ['entities', 'nextCursor'],
  properties: {
    entities: { type: 'array', items: { $ref: ids.entity } },
    nextCursor: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const satisfies JsonSchema

export const protocolErrorSchema = {
  $schema: draft,
  $id: ids.error,
  title: 'Protocol error',
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    details: true,
  },
  additionalProperties: false,
} as const satisfies JsonSchema
