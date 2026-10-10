/**
 * Entity envelope and projection (World Protocol §4).
 *
 * Every entity a world exposes is produced by a projection: an explicit function from the
 * world's own record to protocol attributes. There is no "raw" serialisation path.
 */

export type Visibility = 'public' | 'connections' | 'private'

export interface EntityRef {
  world: string
  type: string
  id: string
}

export interface Relationship {
  rel: string
  target: Omit<EntityRef, 'world'> & { world?: string }
}

/** Required disclosure for sponsored content. Consumers must render the label. */
export interface Sponsorship {
  sponsor: { name: string; ref?: EntityRef }
  label: 'sponsored' | 'presented_by'
  campaign?: string
}

export interface Layer {
  id: string
  /** Sensitive layers (e.g. faith) never feed exports, aggregates or person projections. */
  sensitivity: 'normal' | 'sensitive'
}

/** Structural location type so core stays independent of any geo implementation. */
export type EntityLocation = { kind: string } & Record<string, unknown>

export interface Entity<Attributes> {
  ref: EntityRef
  version: number
  updatedAt: string
  visibility: Visibility
  attributes: Attributes
  location?: EntityLocation
  relationships: Relationship[]
  capabilities: string[]
  links?: Record<string, string>
  sponsorship?: Sponsorship
  layer?: string
}

export interface Caller {
  kind: 'anonymous' | 'person' | 'world' | 'agent'
  scopes: readonly string[]
}

export interface ProjectionContext {
  world: string
  caller: Caller
}

export interface EntityProjection<Row, Attributes> {
  type: string
  id(row: Row): string
  version(row: Row): number
  updatedAt(row: Row): Date
  visibility(row: Row): Visibility
  attributes(row: Row, ctx: ProjectionContext): Attributes
  location?(row: Row, ctx: ProjectionContext): EntityLocation | undefined
  relationships?(row: Row, ctx: ProjectionContext): Relationship[]
  /** Actions this caller may invoke on this entity right now. */
  capabilities?(row: Row, ctx: ProjectionContext): string[]
  links?(row: Row, ctx: ProjectionContext): Record<string, string>
  sponsorship?(row: Row): Sponsorship | undefined
  layer?(row: Row): string | undefined
}

export function canSee(visibility: Visibility, caller: Caller, type: string): boolean {
  if (visibility === 'public') return true
  if (visibility === 'connections') return caller.kind === 'world' || caller.scopes.includes(`read:${shortType(type)}`)
  return caller.scopes.includes(`read:private:${shortType(type)}`)
}

function shortType(type: string): string {
  const separator = type.indexOf(':')
  return separator >= 0 ? type.slice(separator + 1) : type
}

export function defineEntityProjection<Row, Attributes>(
  projection: EntityProjection<Row, Attributes>
): EntityProjection<Row, Attributes> {
  return projection
}

/** Project one record for one caller. Returns null when the caller may not see it. */
export function project<Row, Attributes>(
  projection: EntityProjection<Row, Attributes>,
  row: Row,
  ctx: ProjectionContext
): Entity<Attributes> | null {
  const visibility = projection.visibility(row)
  if (!canSee(visibility, ctx.caller, projection.type)) return null

  const entity: Entity<Attributes> = {
    ref: { world: ctx.world, type: projection.type, id: projection.id(row) },
    version: projection.version(row),
    updatedAt: projection.updatedAt(row).toISOString(),
    visibility,
    attributes: projection.attributes(row, ctx),
    relationships: projection.relationships?.(row, ctx) ?? [],
    capabilities: projection.capabilities?.(row, ctx) ?? [],
  }

  const location = projection.location?.(row, ctx)
  if (location) entity.location = location
  const links = projection.links?.(row, ctx)
  if (links) entity.links = links
  const sponsorship = projection.sponsorship?.(row)
  if (sponsorship) entity.sponsorship = sponsorship
  const layer = projection.layer?.(row)
  if (layer) entity.layer = layer

  return entity
}

/** Entities in sensitive layers may be shown to opted-in users but never exported or aggregated. */
export function isExportable(entity: Pick<Entity<unknown>, 'layer'>, layers: readonly Layer[]): boolean {
  if (!entity.layer) return true
  const layer = layers.find((candidate) => candidate.id === entity.layer)
  return layer?.sensitivity !== 'sensitive'
}
