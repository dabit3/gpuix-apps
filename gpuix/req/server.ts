#!/usr/bin/env bun
/**
 * A small local API for req to hit. Every request is logged as one line:
 *   bun server.ts            # port 4000
 *   bun server.ts --port 4001
 */
const argPort = process.argv.indexOf('--port')
const port = Number(argPort > 0 ? process.argv[argPort + 1] : (process.env.PORT ?? 4000))

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[39m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  grey: (s: string) => `\x1b[90m${s}\x1b[39m`,
}

const methodColor: Record<string, (s: string) => string> = {
  GET: c.green,
  POST: c.yellow,
  PUT: c.blue,
  PATCH: c.cyan,
  DELETE: c.red,
}

export const PRODUCTS = [
  { id: 'p_1042', name: 'Aeron Chair', brand: 'Herman Miller', price: 1395, currency: 'USD', stock: 14, rating: 4.7, tags: ['office', 'ergonomic'] },
  { id: 'p_2001', name: 'Studio Display', brand: 'Apple', price: 1599, currency: 'USD', stock: 6, rating: 4.5, tags: ['monitor', '5k'] },
  { id: 'p_2210', name: 'MX Master 3S', brand: 'Logitech', price: 99, currency: 'USD', stock: 212, rating: 4.8, tags: ['mouse'] },
  { id: 'p_3307', name: 'Model 01 Keyboard', brand: 'Keyboardio', price: 329, currency: 'USD', stock: 0, rating: 4.4, tags: ['keyboard', 'split'] },
  { id: 'p_3410', name: 'Desk Mat XL', brand: 'Grovemade', price: 120, currency: 'USD', stock: 57, rating: 4.6, tags: ['desk'] },
  { id: 'p_4120', name: 'Hue Play Light Bar', brand: 'Philips', price: 139, currency: 'USD', stock: 33, rating: 4.3, tags: ['lighting'] },
  { id: 'p_5003', name: 'AirPods Pro', brand: 'Apple', price: 249, currency: 'USD', stock: 88, rating: 4.6, tags: ['audio'] },
]

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': crypto.randomUUID().slice(0, 8), ...headers },
  })

let orderSeq = 7731
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function route(req: Request, url: URL): Promise<Response> {
  const p = url.pathname
  if (p === '/health') return json({ ok: true, uptime_s: Math.round(process.uptime()), version: '1.4.2' })
  if (p.startsWith('/api/') && !req.headers.get('x-api-key'))
    return json({ error: 'unauthorized', message: 'Missing X-Api-Key header' }, 401)

  if (p === '/api/products' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 20)
    const sort = url.searchParams.get('sort')
    const list = [...PRODUCTS].sort((a, b) => (sort === 'price' ? a.price - b.price : 0)).slice(0, limit)
    return json({ data: list, total: PRODUCTS.length, limit, next_cursor: limit < PRODUCTS.length ? `cur_${limit}` : null })
  }
  const product = /^\/api\/products\/(\w+)$/.exec(p)
  if (product && req.method === 'GET') {
    const found = PRODUCTS.find((x) => x.id === product[1])
    return found
      ? json({ ...found, dimensions: { w_cm: 68.5, h_cm: 104, d_cm: 66 }, warehouse: { city: 'Reno', region: 'us-west-2' } })
      : json({ error: 'not_found', message: `No product ${product[1]}` }, 404)
  }
  if (p === '/api/orders' && req.method === 'POST') {
    let body: { customer?: string; items?: { sku: string; qty: number }[]; shipping?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ error: 'bad_request', message: 'Body must be JSON' }, 400)
    }
    if (!body.items?.length) return json({ error: 'validation', message: 'items must not be empty' }, 422)
    const lines = body.items.map((it) => {
      const prod = PRODUCTS.find((x) => x.id === it.sku)
      return { sku: it.sku, name: prod?.name ?? 'Unknown', qty: it.qty, unit_price: prod?.price ?? 0, total: (prod?.price ?? 0) * it.qty }
    })
    const subtotal = lines.reduce((s, l) => s + l.total, 0)
    const shipping = body.shipping === 'express' ? 35 : 0
    return json(
      {
        id: `ord_${orderSeq++}`,
        status: 'confirmed',
        customer: body.customer,
        lines,
        amounts: { subtotal, shipping, tax: Math.round(subtotal * 0.0825), total: subtotal + shipping + Math.round(subtotal * 0.0825) },
        eta: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10),
      },
      201,
      { location: `/api/orders/ord_${orderSeq - 1}` },
    )
  }
  if (p === '/api/reports/daily') {
    await sleep(Math.min(Number(url.searchParams.get('delay') ?? 500), 5000))
    return json({
      date: new Date().toISOString().slice(0, 10),
      orders: 1284,
      revenue_usd: 214_390.5,
      top_products: PRODUCTS.slice(0, 3).map((x) => ({ id: x.id, name: x.name, units: Math.round(x.rating * 37) })),
      by_region: { 'us-west-2': 512, 'us-east-1': 488, 'eu-central-1': 284 },
    })
  }
  return json({ error: 'not_found', message: `No route for ${req.method} ${p}` }, 404)
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length))
const statusColor = (s: number) => (s < 300 ? c.green : s < 400 ? c.cyan : s < 500 ? c.yellow : c.red)

const server = Bun.serve({
  port,
  async fetch(req) {
    const started = performance.now()
    const url = new URL(req.url)
    const res = await route(req, url)
    const ms = performance.now() - started
    const size = Number((await res.clone().arrayBuffer()).byteLength)
    const time = new Date().toTimeString().slice(0, 8)
    const m = (methodColor[req.method] ?? c.grey)(pad(req.method, 6))
    console.log(
      `${c.grey(time)}  ${m} ${pad(url.pathname + url.search, 38)} ${statusColor(res.status)(String(res.status))}  ${c.dim(pad(`${ms.toFixed(1)} ms`, 9))} ${c.dim(`${(size / 1024).toFixed(1)} KB`)}`,
    )
    return res
  },
})

console.log(`\n  ${c.bold('orders-api')} ${c.grey('v1.4.2')}  listening on ${c.cyan(`http://localhost:${server.port}`)}`)
console.log(c.grey(`  routes: /health · /api/products · /api/products/:id · POST /api/orders · /api/reports/daily\n`))
