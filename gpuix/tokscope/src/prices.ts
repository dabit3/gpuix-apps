import type { Price } from './types'

export type PriceSheet = {
  note: string
  /** USD per million tokens, matched by substring of the model id (first match wins) */
  models: Array<{ match: string; label: string } & Price>
  route: { match: string; label: string }
  cacheTTLMinutes: number
}

export const DEFAULT_PRICES: PriceSheet = {
  note: 'USD per 1M tokens. Check against the provider price sheet before relying on totals.',
  models: [
    { match: 'opus', label: 'Opus', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    { match: 'sonnet', label: 'Sonnet', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    { match: 'haiku', label: 'Haiku', input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    { match: '', label: 'Default', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  ],
  route: { match: 'haiku', label: 'Haiku' },
  cacheTTLMinutes: 5,
}

export function priceFor(sheet: PriceSheet, model: string): Price {
  const m = model.toLowerCase()
  for (const p of sheet.models) if (m.includes(p.match)) return p
  return sheet.models[sheet.models.length - 1]!
}

export async function loadPrices(path?: string): Promise<PriceSheet> {
  if (!path) return DEFAULT_PRICES
  const raw = (await Bun.file(path).json()) as Partial<PriceSheet>
  return { ...DEFAULT_PRICES, ...raw, models: raw.models ?? DEFAULT_PRICES.models }
}
