import { describe, expect, it } from 'vitest'

import {
  applySmallPopulationRule,
  coarsenOneLevel,
  distanceBucket,
  effectivePrecision,
  snapToCell,
  toPublicLocation,
} from './index'

// Synthetic points around Yaba, Lagos.
const SHOP = { lat: 6.51234, lng: 3.37891 }
const NEIGHBOUR = { lat: 6.51301, lng: 3.37802 }
const ACROSS_TOWN = { lat: 6.43012, lng: 3.42111 } // Victoria Island-ish
const FAR_AWAY = { lat: 9.05785, lng: 7.49508 } // Abuja-ish

describe('effectivePrecision', () => {
  it('takes the least precise ceiling', () => {
    expect(effectivePrecision('exact', 'street', 'neighbourhood')).toBe('neighbourhood')
    expect(effectivePrecision('lga', 'exact')).toBe('lga')
  })

  it('reveals nothing when there are no ceilings', () => {
    expect(effectivePrecision()).toBe('none')
  })
})

describe('coarsenOneLevel / applySmallPopulationRule', () => {
  it('steps one level coarser and stops at none', () => {
    expect(coarsenOneLevel('neighbourhood')).toBe('lga')
    expect(coarsenOneLevel('none')).toBe('none')
  })

  it('coarsens sparse cells but leaves exact and dense cells alone', () => {
    expect(applySmallPopulationRule('neighbourhood', 1)).toBe('lga')
    expect(applySmallPopulationRule('neighbourhood', 5)).toBe('neighbourhood')
    expect(applySmallPopulationRule('exact', 0)).toBe('exact')
  })
})

describe('toPublicLocation', () => {
  it('publishes exact points only when precision is exact', () => {
    const location = toPublicLocation(SHOP, 'exact')
    expect(location).toMatchObject({ kind: 'geo', precision: 'exact', point: SHOP })
  })

  it('never returns the true point for coarser precisions', () => {
    for (const precision of ['street', 'neighbourhood', 'lga', 'city'] as const) {
      const location = toPublicLocation(SHOP, precision)
      expect(location.kind).toBe('geo')
      if (location.kind === 'geo' && 'point' in location) {
        expect(location.point).not.toEqual(SHOP)
      }
    }
  })

  it('is deterministic: nearby points in the same cell publish identically', () => {
    const a = toPublicLocation(SHOP, 'lga')
    const b = toPublicLocation(NEIGHBOUR, 'lga')
    expect(a).toEqual(b)
  })

  it('omits coordinates entirely for country and none', () => {
    expect(toPublicLocation(SHOP, 'country', 'Nigeria')).toEqual({ kind: 'geo', precision: 'country', label: 'Nigeria' })
    expect(toPublicLocation(SHOP, 'none')).toEqual({ kind: 'none' })
  })

  it('rejects invalid coordinates', () => {
    expect(() => toPublicLocation({ lat: 200, lng: 3 }, 'exact')).toThrow('Invalid coordinates')
  })
})

describe('distanceBucket', () => {
  const cell = (point: { lat: number; lng: number }) => snapToCell(point, 9).cell

  it('buckets distances instead of returning metres', () => {
    expect(distanceBucket(cell(SHOP), cell(NEIGHBOUR))).toBe('nearby')
    expect(distanceBucket(cell(SHOP), cell(ACROSS_TOWN))).toBe('across_the_city')
    expect(distanceBucket(cell(SHOP), cell(FAR_AWAY))).toBe('far')
  })
})
