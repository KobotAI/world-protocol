export const WORLD_PROTOCOL_VERSION = 'world/0.1' as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface WorldEndpoints {
  api: string
  events?: string
  subscriptions?: string
  authorization?: string
  token?: string
  jwks?: string
  mcp?: string
  [name: string]: string | undefined
}

export interface WorldCurrency {
  code: string
  settlement: 'fiat' | 'virtual'
}

export interface WorldDiscoveryDocument {
  protocol: typeof WORLD_PROTOCOL_VERSION
  id: string
  name: string
  description?: string
  endpoints: WorldEndpoints
  entityTypes: string[]
  events?: string[]
  actions?: string[]
  scopes?: string[]
  extensions?: string[]
  layers?: string[]
  currencies?: WorldCurrency[]
}

export interface EntityRef {
  world: string
  type: string
  id: string
}

export interface EntityRelationship {
  rel: string
  target: Omit<EntityRef, 'world'> & { world?: string }
}

export interface EntityEnvelope<Attributes extends JsonObject = JsonObject> {
  ref: EntityRef
  version: number
  updatedAt: string
  visibility: 'public' | 'connections' | 'private'
  attributes: Attributes
  location?: JsonObject
  relationships: EntityRelationship[]
  capabilities: string[]
  links?: Record<string, string>
  sponsorship?: JsonObject
  layer?: string
}

export interface PaginatedEntityCollection<Attributes extends JsonObject = JsonObject> {
  entities: EntityEnvelope<Attributes>[]
  nextCursor: string | null
}

export interface MoneyFilter {
  amount: number
  currency: string
}

export interface DiscoverQuery {
  types?: string[]
  text?: string
  category?: string
  near?: { cell: string }
  radius?: 'nearby' | 'district' | 'city'
  price?: { min?: MoneyFilter; max?: MoneyFilter }
  layer?: string
  limit?: number
  cursor?: string | null
}

export interface DiscoverResult<Attributes extends JsonObject = JsonObject>
  extends PaginatedEntityCollection<Attributes> {}

export interface ProtocolError {
  code: string
  message: string
  details?: JsonValue
}
