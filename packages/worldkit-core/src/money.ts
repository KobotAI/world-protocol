/**
 * Money and reality invariants (World Protocol §4.2).
 *
 * - Real offers are priced in fiat; virtual offers in a world-issued virtual currency.
 * - A purchase must be paid in the same settlement class and currency as the offer.
 * - A world only accepts virtual currencies it issues.
 * - There is deliberately no virtual → fiat conversion anywhere in the protocol.
 */

export type Reality = 'real' | 'virtual'
export type Settlement = 'fiat' | 'virtual'

export interface Money {
  /** Integer minor units (kobo for NGN). Never a float. */
  amount: number
  currency: string
  settlement: Settlement
}

const FIAT_CURRENCY = /^[A-Z]{3}$/
/** `<issuing-world-host>:<code>`, e.g. `world.example.com:gold`. */
const VIRTUAL_CURRENCY = /^[a-z0-9.-]+\.[a-z]{2,}:[a-z0-9_-]+$/

export class WorldMoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorldMoneyError'
  }
}

export function money(amount: number, currency: string, settlement: Settlement): Money {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new WorldMoneyError(`Money amount must be a non-negative integer in minor units, got ${amount}`)
  }
  if (settlement === 'fiat' && !FIAT_CURRENCY.test(currency)) {
    throw new WorldMoneyError(`Fiat currency must be an ISO-4217 code, got "${currency}"`)
  }
  if (settlement === 'virtual' && !VIRTUAL_CURRENCY.test(currency)) {
    throw new WorldMoneyError(`Virtual currency must be namespaced as "<world-host>:<code>", got "${currency}"`)
  }
  return { amount, currency, settlement }
}

export function issuerOf(currency: string): string | null {
  const separator = currency.indexOf(':')
  return separator > 0 ? currency.slice(0, separator) : null
}

/** A real offer must be priced in fiat; a virtual one in virtual currency. */
export function assertOfferPrice(reality: Reality, price: Money): void {
  const expected: Settlement = reality === 'real' ? 'fiat' : 'virtual'
  if (price.settlement !== expected) {
    throw new WorldMoneyError(`A ${reality} offer must be priced in ${expected} currency, got ${price.settlement} (${price.currency})`)
  }
}

export interface PaymentInstrument {
  currency: string
  settlement: Settlement
}

/**
 * Checks a purchase before it reaches any payment code.
 * `worldHost` is the host of the world selling the offer.
 */
export function assertCanPay(offer: { reality: Reality; price: Money }, instrument: PaymentInstrument, worldHost: string): void {
  assertOfferPrice(offer.reality, offer.price)

  if (instrument.settlement !== offer.price.settlement) {
    throw new WorldMoneyError(
      `Cannot pay a ${offer.price.settlement} price with a ${instrument.settlement} instrument`
    )
  }
  if (instrument.currency !== offer.price.currency) {
    throw new WorldMoneyError(`Currency mismatch: offer is ${offer.price.currency}, instrument is ${instrument.currency}`)
  }
  if (instrument.settlement === 'virtual' && issuerOf(instrument.currency) !== worldHost) {
    throw new WorldMoneyError(`${worldHost} only accepts virtual currency it issues, got ${instrument.currency}`)
  }
}

/** Format minor units for display, e.g. 7500000 NGN → "₦75,000". Virtual amounts are whole units. */
export function formatMoney(value: Money, locale = 'en-NG'): string {
  if (value.settlement === 'virtual') {
    return `${new Intl.NumberFormat(locale).format(value.amount)} ${value.currency.split(':')[1] ?? ''}`.trim()
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    maximumFractionDigits: value.amount % 100 === 0 ? 0 : 2,
  }).format(value.amount / 100)
}
