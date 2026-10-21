import { money, subtract, type Money } from './money'

export type Discount =
  | { kind: 'percent'; code: string; percent: number; minSubtotal?: number }
  | { kind: 'fixed'; code: string; off: number; minSubtotal?: number }
  | { kind: 'bogo'; code: string; sku: string }

export const CODES: Record<string, Discount> = {
  WELCOME10: { kind: 'percent', code: 'WELCOME10', percent: 10 },
  BREW25: { kind: 'percent', code: 'BREW25', percent: 25, minSubtotal: 10000 },
  FIVEOFF: { kind: 'fixed', code: 'FIVEOFF', off: 500, minSubtotal: 2500 },
  MUGBOGO: { kind: 'bogo', code: 'MUGBOGO', sku: 'MUG-01' },
}

export function lookupCode(raw: string): Discount | undefined {
  return CODES[raw.trim().toUpperCase()]
}

export function percentOff(subtotal: Money, percent: number): Money {
  const off = Math.round((subtotal.amount * percent) / 100)
  return money(off, subtotal.currency)
}

export function discountAmount(subtotal: Money, d: Discount, unitPrices: Record<string, { price: number; qty: number }> = {}): Money {
  if ('minSubtotal' in d && d.minSubtotal && subtotal.amount < d.minSubtotal) return money(0, subtotal.currency)
  switch (d.kind) {
    case 'percent':
      return percentOff(subtotal, d.percent)
    case 'fixed':
      return money(Math.min(d.off, subtotal.amount), subtotal.currency)
    case 'bogo': {
      const line = unitPrices[d.sku]
      if (!line) return money(0, subtotal.currency)
      return money(Math.floor(line.qty / 2) * line.price, subtotal.currency)
    }
  }
}

export function applyDiscount(subtotal: Money, d: Discount | undefined, unitPrices?: Record<string, { price: number; qty: number }>): Money {
  if (!d) return subtotal
  return subtract(subtotal, discountAmount(subtotal, d, unitPrices))
}
