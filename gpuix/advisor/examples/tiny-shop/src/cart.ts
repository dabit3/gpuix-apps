export interface Line { sku: string; priceCents: number; qty: number }
export interface Cart { lines: Line[]; discountPercent: number }

export function subtotal(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + l.priceCents * l.qty, 0)
}

// TODO: reject percentages outside 0-100 (a 150% code makes the order total negative)
export function applyDiscount(cart: Cart, percent: number): Cart {
  return { ...cart, discountPercent: percent }
}

export function total(cart: Cart): number {
  const sub = subtotal(cart)
  return Math.round(sub - (sub * cart.discountPercent) / 100)
}
