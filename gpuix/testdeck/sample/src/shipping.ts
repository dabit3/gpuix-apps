import { money, type Money } from './money'

export type Region = 'domestic' | 'canada' | 'europe' | 'asia'
export type Speed = 'standard' | 'express' | 'overnight'

const BASE: Record<Region, number> = { domestic: 595, canada: 1295, europe: 1895, asia: 2295 }
const PER_KG: Record<Region, number> = { domestic: 150, canada: 300, europe: 450, asia: 550 }
const SPEED: Record<Speed, number> = { standard: 1, express: 1.6, overnight: 2.5 }
export const FREE_SHIPPING_OVER = 7500

export function quote(weightGrams: number, region: Region, speed: Speed = 'standard', subtotal = 0): Money {
  if (weightGrams <= 0) return money(0)
  if (region === 'domestic' && speed === 'standard' && subtotal >= FREE_SHIPPING_OVER) return money(0)
  if (region === 'domestic' && speed === 'overnight' && weightGrams > 10_000) throw new Error('overnight is limited to 10 kg')
  const kg = Math.ceil(weightGrams / 1000)
  return money(Math.round((BASE[region] + PER_KG[region] * (kg - 1)) * SPEED[speed]))
}

export function eta(region: Region, speed: Speed): [number, number] {
  const base: Record<Region, [number, number]> = { domestic: [3, 5], canada: [5, 8], europe: [7, 12], asia: [9, 15] }
  const [lo, hi] = base[region]
  if (speed === 'overnight') return [1, 1]
  if (speed === 'express') return [Math.max(1, Math.ceil(lo / 2)), Math.ceil(hi / 2)]
  return [lo, hi]
}
