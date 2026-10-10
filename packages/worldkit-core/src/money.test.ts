import { describe, expect, it } from 'vitest'

import { assertCanPay, assertOfferPrice, formatMoney, money, WorldMoneyError } from './money'

const WORLD = 'world.kobotai.co'
const naira = (amount: number) => money(amount, 'NGN', 'fiat')
const cowries = (amount: number) => money(amount, 'world.kobotai.co:cowrie', 'virtual')

describe('money', () => {
  it('requires integer minor units', () => {
    expect(() => money(75000.5, 'NGN', 'fiat')).toThrow(WorldMoneyError)
    expect(() => money(-1, 'NGN', 'fiat')).toThrow('non-negative integer')
  })

  it('keeps fiat and virtual currency codes apart', () => {
    expect(() => money(100, 'cowrie', 'virtual')).toThrow('namespaced')
    expect(() => money(100, 'world.kobotai.co:cowrie', 'fiat')).toThrow('ISO-4217')
    expect(() => money(100, 'NGN', 'virtual')).toThrow('namespaced')
  })
})

describe('assertOfferPrice', () => {
  it('prices real offers in fiat and virtual offers in virtual currency', () => {
    expect(() => assertOfferPrice('real', naira(7_500_000))).not.toThrow()
    expect(() => assertOfferPrice('virtual', cowries(250))).not.toThrow()
    expect(() => assertOfferPrice('real', cowries(250))).toThrow('real offer must be priced in fiat')
    expect(() => assertOfferPrice('virtual', naira(100))).toThrow('virtual offer must be priced in virtual')
  })
})

describe('assertCanPay', () => {
  const realOffer = { reality: 'real' as const, price: naira(7_500_000) }
  const playOffer = { reality: 'virtual' as const, price: cowries(250) }

  it('accepts matching instruments', () => {
    expect(() => assertCanPay(realOffer, { currency: 'NGN', settlement: 'fiat' }, WORLD)).not.toThrow()
    expect(() => assertCanPay(playOffer, { currency: 'world.kobotai.co:cowrie', settlement: 'virtual' }, WORLD)).not.toThrow()
  })

  it('never lets play currency pay for real goods', () => {
    expect(() =>
      assertCanPay(realOffer, { currency: 'world.kobotai.co:cowrie', settlement: 'virtual' }, WORLD)
    ).toThrow('Cannot pay a fiat price with a virtual instrument')
  })

  it('never lets real money pay a play price directly', () => {
    expect(() => assertCanPay(playOffer, { currency: 'NGN', settlement: 'fiat' }, WORLD)).toThrow(
      'Cannot pay a virtual price with a fiat instrument'
    )
  })

  it("rejects another world's play currency", () => {
    const foreignOffer = { reality: 'virtual' as const, price: money(10, 'other.world:gold', 'virtual') }
    expect(() => assertCanPay(foreignOffer, { currency: 'other.world:gold', settlement: 'virtual' }, WORLD)).toThrow(
      'only accepts virtual currency it issues'
    )
  })
})

describe('formatMoney', () => {
  it('formats naira from kobo and play currency as whole units', () => {
    expect(formatMoney(naira(7_500_000))).toBe('₦75,000')
    expect(formatMoney(cowries(1250))).toBe('1,250 cowrie')
  })
})
