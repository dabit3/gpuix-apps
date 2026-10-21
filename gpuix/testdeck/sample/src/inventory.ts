export interface StockApi {
  available(sku: string): Promise<number>
  reserve(sku: string, qty: number): Promise<string>
  release(token: string): Promise<void>
}

export class FakeWarehouse implements StockApi {
  private stock = new Map<string, number>()
  private holds = new Map<string, { sku: string; qty: number }>()
  private seq = 0
  constructor(initial: Record<string, number>, private latencyMs = 25) {
    for (const [k, v] of Object.entries(initial)) this.stock.set(k, v)
  }
  private wait() {
    return Bun.sleep(this.latencyMs)
  }
  async available(sku: string) {
    await this.wait()
    return this.stock.get(sku) ?? 0
  }
  async reserve(sku: string, qty: number) {
    await this.wait()
    const have = this.stock.get(sku) ?? 0
    if (have < qty) throw new Error(`only ${have} ${sku} left`)
    this.stock.set(sku, have - qty)
    const token = `hold_${++this.seq}`
    this.holds.set(token, { sku, qty })
    return token
  }
  async release(token: string) {
    await this.wait()
    const hold = this.holds.get(token)
    if (!hold) return
    this.stock.set(hold.sku, (this.stock.get(hold.sku) ?? 0) + hold.qty)
    this.holds.delete(token)
  }
}

export async function reserveAll(api: StockApi, lines: { sku: string; qty: number }[]): Promise<string[]> {
  const tokens: string[] = []
  try {
    for (const l of lines) tokens.push(await api.reserve(l.sku, l.qty))
    return tokens
  } catch (err) {
    await Promise.all(tokens.map((t) => api.release(t)))
    throw err
  }
}
