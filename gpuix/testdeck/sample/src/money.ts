export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY'

const MINOR: Record<Currency, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0 }
const SYMBOL: Record<Currency, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

export interface Money {
  amount: number
  currency: Currency
}

export function money(amount: number, currency: Currency = 'USD'): Money {
  if (!Number.isInteger(amount)) throw new Error(`amount must be in minor units, got ${amount}`)
  return { amount, currency }
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

export function subtract(a: Money, b: Money): Money {
  assertSame(a, b)
  return { amount: a.amount - b.amount, currency: a.currency }
}

export function multiply(a: Money, factor: number): Money {
  return { amount: Math.round(a.amount * factor), currency: a.currency }
}

export function allocate(a: Money, ratios: number[]): Money[] {
  const total = ratios.reduce((s, r) => s + r, 0)
  const parts = ratios.map((r) => Math.floor((a.amount * r) / total))
  let rest = a.amount - parts.reduce((s, p) => s + p, 0)
  for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i]++
  return parts.map((amount) => ({ amount, currency: a.currency }))
}

export function format(m: Money): string {
  const digits = MINOR[m.currency]
  const value = m.amount / 10 ** digits
  const sign = value < 0 ? '-' : ''
  const body = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${sign}${SYMBOL[m.currency]}${body}`
}

export function parse(input: string, currency: Currency = 'USD'): Money {
  const clean = input.replace(/[^0-9.\-]/g, '')
  if (!clean || Number.isNaN(Number(clean))) throw new Error(`cannot parse "${input}"`)
  return money(Math.round(Number(clean) * 10 ** MINOR[currency]), currency)
}

function assertSame(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`)
}
