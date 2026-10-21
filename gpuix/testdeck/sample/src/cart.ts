import { add, money, multiply, type Money } from './money'

export interface Product {
  sku: string
  name: string
  price: Money
  weightGrams: number
}

export interface LineItem {
  product: Product
  quantity: number
}

export class Cart {
  private items = new Map<string, LineItem>()

  add(product: Product, quantity = 1): this {
    if (quantity <= 0) throw new Error('quantity must be positive')
    const existing = this.items.get(product.sku)
    this.items.set(product.sku, { product, quantity: (existing?.quantity ?? 0) + quantity })
    return this
  }

  remove(sku: string, quantity = Infinity): this {
    const line = this.items.get(sku)
    if (!line) return this
    const left = line.quantity - quantity
    if (left > 0) this.items.set(sku, { ...line, quantity: left })
    else this.items.delete(sku)
    return this
  }

  get lines(): LineItem[] {
    return [...this.items.values()]
  }

  get count(): number {
    return this.lines.reduce((n, l) => n + l.quantity, 0)
  }

  get weightGrams(): number {
    return this.lines.reduce((g, l) => g + l.product.weightGrams * l.quantity, 0)
  }

  subtotal(): Money {
    return this.lines.reduce((sum, l) => add(sum, multiply(l.product.price, l.quantity)), money(0))
  }

  isEmpty(): boolean {
    return this.items.size === 0
  }
}
