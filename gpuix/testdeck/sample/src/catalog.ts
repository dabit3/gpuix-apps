import { money } from './money'
import type { Product } from './cart'

export const mug: Product = { sku: 'MUG-01', name: 'Stoneware Mug', price: money(1800), weightGrams: 420 }
export const beans: Product = { sku: 'BEAN-250', name: 'Single Origin Beans 250g', price: money(1450), weightGrams: 260 }
export const grinder: Product = { sku: 'GRND-PRO', name: 'Burr Grinder', price: money(12900), weightGrams: 2100 }
export const filter: Product = { sku: 'FILT-100', name: 'Paper Filters ×100', price: money(650), weightGrams: 120 }
