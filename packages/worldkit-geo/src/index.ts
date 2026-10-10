import { cellToLatLng, cellToParent, getResolution, gridDistance, latLngToCell } from 'h3-js'

/**
 * Location precision for World Protocol worlds.
 *
 * True locations never leave a world raw. They are reduced to a public precision by snapping
 * to the centre of a hierarchical H3 cell. Snapping is deterministic, so repeated queries reveal
 * nothing new (unlike random jitter, which can be averaged away).
 */

export const PRECISION_LEVELS = [
  'exact',
  'street',
  'neighbourhood',
  'lga',
  'city',
  'country',
  'none',
] as const

export type Precision = (typeof PRECISION_LEVELS)[number]

export interface LatLng {
  lat: number
  lng: number
}

/** H3 resolution used to snap each cell-based precision level. */
export const PRECISION_RESOLUTION = {
  street: 9,
  neighbourhood: 8,
  lga: 7,
  city: 5,
} as const satisfies Partial<Record<Precision, number>>

type CellPrecision = keyof typeof PRECISION_RESOLUTION

/** Resolution at which exact points are indexed (≈ 15 m² cells). */
export const EXACT_INDEX_RESOLUTION = 13

export type PublicLocation =
  | { kind: 'geo'; precision: 'exact'; point: LatLng; cell: string; label?: string }
  | { kind: 'geo'; precision: CellPrecision; point: LatLng; cell: string; label?: string }
  | { kind: 'geo'; precision: 'country'; label?: string }
  | { kind: 'none' }

function rank(precision: Precision): number {
  return PRECISION_LEVELS.indexOf(precision)
}

export function isPrecision(value: unknown): value is Precision {
  return typeof value === 'string' && (PRECISION_LEVELS as readonly string[]).includes(value)
}

/** The less precise of two levels. */
export function coarser(a: Precision, b: Precision): Precision {
  return rank(a) >= rank(b) ? a : b
}

/**
 * Effective precision = the minimum of every ceiling that applies
 * (participant choice, world ceiling, grant ceiling). With no ceilings, nothing is revealed.
 */
export function effectivePrecision(...ceilings: Precision[]): Precision {
  if (ceilings.length === 0) return 'none'
  return ceilings.reduce(coarser)
}

/** One level coarser (exact → street → … → none). */
export function coarsenOneLevel(precision: Precision): Precision {
  const next = PRECISION_LEVELS[Math.min(rank(precision) + 1, PRECISION_LEVELS.length - 1)]
  return next ?? 'none'
}

/**
 * Small-population rule: when a cell holds fewer than `k` public businesses,
 * a non-exact location is published one level coarser so it can't act as a pin.
 */
export function applySmallPopulationRule(
  precision: Precision,
  publicBusinessesInCell: number,
  k = 3
): Precision {
  if (precision === 'exact' || precision === 'none') return precision
  return publicBusinessesInCell < k ? coarsenOneLevel(precision) : precision
}

function assertValidPoint(point: LatLng): void {
  const { lat, lng } = point
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`)
  }
}

/** Snap a point to the centre of its H3 cell at `resolution`. Deterministic. */
export function snapToCell(point: LatLng, resolution: number): { cell: string; center: LatLng } {
  assertValidPoint(point)
  const cell = latLngToCell(point.lat, point.lng, resolution)
  const [lat, lng] = cellToLatLng(cell)
  return { cell, center: { lat, lng } }
}

/**
 * The only way to turn a true location into something publishable.
 * The returned point is the cell centre for every level except `exact`.
 */
export function toPublicLocation(point: LatLng, precision: Precision, label?: string): PublicLocation {
  if (precision === 'none') return { kind: 'none' }
  if (precision === 'country') return { kind: 'geo', precision, ...(label ? { label } : {}) }

  if (precision === 'exact') {
    assertValidPoint(point)
    return {
      kind: 'geo',
      precision,
      point: { lat: round(point.lat, 6), lng: round(point.lng, 6) },
      cell: latLngToCell(point.lat, point.lng, EXACT_INDEX_RESOLUTION),
      ...(label ? { label } : {}),
    }
  }

  const { cell, center } = snapToCell(point, PRECISION_RESOLUTION[precision])
  return {
    kind: 'geo',
    precision,
    point: { lat: round(center.lat, 6), lng: round(center.lng, 6) },
    cell,
    ...(label ? { label } : {}),
  }
}

export type DistanceBucket = 'nearby' | 'in_your_area' | 'across_the_city' | 'far'

/** Resolution at which distance buckets are computed (≈ 0.7 km² cells). */
export const BUCKET_RESOLUTION = 8

function toBucketCell(cell: string): string {
  const resolution = getResolution(cell)
  return resolution > BUCKET_RESOLUTION ? cellToParent(cell, BUCKET_RESOLUTION) : cell
}

/**
 * Coarse distance between two cells. Never exposes metres, so results can't be
 * used to triangulate a private location.
 */
export function distanceBucket(fromCell: string, toCell: string): DistanceBucket {
  const from = toBucketCell(fromCell)
  const to = toBucketCell(toCell)
  if (getResolution(from) !== getResolution(to)) return 'far'

  let rings: number
  try {
    rings = gridDistance(from, to)
  } catch {
    return 'far'
  }
  if (rings <= 2) return 'nearby'
  if (rings <= 6) return 'in_your_area'
  if (rings <= 25) return 'across_the_city'
  return 'far'
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
