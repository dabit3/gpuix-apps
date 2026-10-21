import { money, type Money } from './money'

export const RATES: Record<string, number> = {
  CA: 0.0725,
  NY: 0.04,
  TX: 0.0625,
  WA: 0.065,
  OR: 0,
}

export function salesTax(taxable: Money, state: string): Money {
  const rate = RATES[state.toUpperCase()]
  if (rate === undefined) throw new Error(`no tax rate for ${state}`)
  return money(Math.round(taxable.amount * rate), taxable.currency)
}

export function vatInclusive(gross: Money, rate: number): { net: Money; vat: Money } {
  const net = Math.round(gross.amount / (1 + rate))
  return { net: money(net, gross.currency), vat: money(gross.amount - net, gross.currency) }
}
