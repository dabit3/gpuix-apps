import type { Cart } from './cart'
import { total } from './cart'

export interface Order { id: string; userId: string; totalCents: number; createdAt: string }

// Contract: totalCents is a non-negative integer (orders.total_cents CHECK >= 0 in 001_init.sql).
export function placeOrder(userId: string, cart: Cart): Order {
  return { id: crypto.randomUUID(), userId, totalCents: total(cart), createdAt: new Date().toISOString() }
}
