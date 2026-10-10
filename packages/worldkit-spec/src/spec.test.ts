import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  WORLD_PROTOCOL_VERSION,
  discoverQuerySchema,
  discoverResultSchema,
  entityEnvelopeSchema,
  entityRefSchema,
  paginatedEntityCollectionSchema,
  protocolErrorSchema,
  worldDiscoveryDocumentSchema,
} from './index.js'
import type {
  DiscoverQuery,
  DiscoverResult,
  EntityEnvelope,
  EntityRef,
  PaginatedEntityCollection,
  ProtocolError,
  WorldDiscoveryDocument,
} from './index.js'

const schemas = [
  worldDiscoveryDocumentSchema,
  entityRefSchema,
  entityEnvelopeSchema,
  paginatedEntityCollectionSchema,
  discoverQuerySchema,
  discoverResultSchema,
  protocolErrorSchema,
]

describe('World Protocol schemas', () => {
  it('exports standalone JSON Schema 2020-12 documents with unique canonical IDs', () => {
    expect(schemas.every((schema) => schema.$schema === 'https://json-schema.org/draft/2020-12/schema')).toBe(true)
    expect(new Set(schemas.map((schema) => schema.$id)).size).toBe(schemas.length)
  })

  it('keeps runtime schemas aligned with required wire fields', () => {
    expect(worldDiscoveryDocumentSchema.required).toEqual(['protocol', 'id', 'name', 'endpoints', 'entityTypes'])
    expect(worldDiscoveryDocumentSchema.properties.protocol.const).toBe(WORLD_PROTOCOL_VERSION)
    expect(entityRefSchema.required).toEqual(['world', 'type', 'id'])
    expect(entityEnvelopeSchema.required).toContain('attributes')
    expect(paginatedEntityCollectionSchema.required).toEqual(['entities', 'nextCursor'])
    expect(discoverResultSchema.required).toEqual(['entities', 'nextCursor'])
    expect(protocolErrorSchema.required).toEqual(['code', 'message'])
  })

  it('models privacy-preserving discovery filters', () => {
    expect(discoverQuerySchema.properties.near.required).toEqual(['cell'])
    expect(discoverQuerySchema.properties.radius.enum).toEqual(['nearby', 'district', 'city'])
    expect(discoverQuerySchema.properties.limit.maximum).toBe(100)
    expect(discoverQuerySchema.properties).not.toHaveProperty('latitude')
    expect(discoverQuerySchema.properties).not.toHaveProperty('longitude')
  })
})

describe('World Protocol TypeScript contract', () => {
  it('exposes the requested public interfaces', () => {
    expectTypeOf<WorldDiscoveryDocument>().toHaveProperty('endpoints')
    expectTypeOf<EntityRef>().toMatchTypeOf<{ world: string; type: string; id: string }>()
    expectTypeOf<EntityEnvelope>().toHaveProperty('attributes')
    expectTypeOf<PaginatedEntityCollection>().toHaveProperty('nextCursor')
    expectTypeOf<DiscoverQuery>().toHaveProperty('near')
    expectTypeOf<DiscoverResult>().toMatchTypeOf<PaginatedEntityCollection>()
    expectTypeOf<ProtocolError>().toHaveProperty('code')
  })
})
