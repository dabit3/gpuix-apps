/**
 * Writes a realistic sample store database: `bun scripts/make-sample.ts [out=sample.db] [orders=1200000]`
 * customers, products, orders (1.2M by default), order_items, plus a few views.
 */
import { Database } from 'bun:sqlite'
import { existsSync, unlinkSync } from 'node:fs'

const out = process.argv[2] ?? 'sample.db'
const ORDERS = Number(process.argv[3] ?? 1_200_000)
for (const f of [out, `${out}-wal`, `${out}-shm`]) if (existsSync(f)) unlinkSync(f)

let seed = 20261021
const rnd = () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!

const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Emma', 'Oliver', 'Sofia', 'Lucas', 'Isla', 'Mateo', 'Chloe', 'Ethan', 'Zoe', 'Leo', 'Maya', 'Kai', 'Nora', 'Arjun', 'Yuki', 'Omar', 'Elena', 'Jonas', 'Priya', 'Diego', 'Hana', 'Felix', 'Amara', 'Theo', 'Lena', 'Sami']
const LAST = ['Chen', 'Garcia', 'Smith', 'Patel', 'Kim', 'Nguyen', 'Müller', 'Rossi', 'Silva', 'Johnson', 'Sato', 'Okafor', 'Novak', 'Haddad', 'Larsen', 'Moreau', 'Kowalski', 'Ibrahim', 'Brown', 'Tanaka']
const CITIES: Array<[string, string]> = [['San Francisco', 'US'], ['New York', 'US'], ['Austin', 'US'], ['Seattle', 'US'], ['Chicago', 'US'], ['Toronto', 'CA'], ['Vancouver', 'CA'], ['London', 'GB'], ['Berlin', 'DE'], ['Paris', 'FR'], ['Amsterdam', 'NL'], ['Stockholm', 'SE'], ['Tokyo', 'JP'], ['Seoul', 'KR'], ['Sydney', 'AU'], ['São Paulo', 'BR'], ['Mexico City', 'MX'], ['Bangalore', 'IN'], ['Lagos', 'NG'], ['Madrid', 'ES']]
const CATS: Array<[string, string[], number]> = [
  ['Audio', ['Wireless Earbuds', 'Studio Headphones', 'Bookshelf Speaker', 'USB Microphone', 'Soundbar'], 129],
  ['Computing', ['Mechanical Keyboard', 'Ergonomic Mouse', 'USB-C Hub', '4K Monitor', 'Laptop Stand', 'Webcam'], 89],
  ['Home', ['Espresso Machine', 'Air Purifier', 'Smart Lamp', 'Cast Iron Pan', 'Robot Vacuum', 'Kettle'], 149],
  ['Outdoor', ['Trail Backpack', 'Running Shoes', 'Rain Shell', 'Camping Stove', 'Water Bottle', 'Headlamp'], 79],
  ['Office', ['Standing Desk', 'Task Chair', 'Desk Mat', 'Notebook Set', 'Fountain Pen', 'Monitor Arm'], 119],
  ['Fitness', ['Yoga Mat', 'Adjustable Dumbbells', 'Fitness Tracker', 'Foam Roller', 'Jump Rope'], 59],
]
const BRANDS = ['Northwind', 'Acme', 'Lumen', 'Vertex', 'Kestrel', 'Harbor', 'Orbit', 'Fjord', 'Summit', 'Atlas']
const STATUS = ['delivered', 'delivered', 'delivered', 'delivered', 'shipped', 'shipped', 'processing', 'cancelled', 'refunded']
const CHANNEL = ['web', 'web', 'ios', 'android', 'marketplace', 'retail']

const db = new Database(out)
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;')
db.exec(`
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, city TEXT, country TEXT, created_at TEXT NOT NULL, lifetime_value REAL DEFAULT 0);
CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL, brand TEXT, price REAL NOT NULL, stock INTEGER NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT NOT NULL, channel TEXT NOT NULL, total REAL NOT NULL, items INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE order_items (order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL);
CREATE TABLE events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
`)
const t0 = performance.now()
const NCUST = 50_000
const insC = db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?,0)')
db.transaction(() => {
  for (let i = 1; i <= NCUST; i++) {
    const f = pick(FIRST), l = pick(LAST), [city, country] = pick(CITIES)
    const d = new Date(Date.UTC(2022, 0, 1) + rnd() * 3.6 * 365 * 86400000)
    insC.run(i, `${f} ${l}`, `${f.toLowerCase()}.${l.toLowerCase().replace(/[^a-z]/g, '')}${i}@example.com`, city, country, d.toISOString().slice(0, 19))
  }
})()
const products: Array<{ id: number; price: number }> = []
const insP = db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?)')
db.transaction(() => {
  let id = 1
  for (const [cat, names, base] of CATS)
    for (const n of names)
      for (const brand of BRANDS.slice(0, 4 + Math.floor(rnd() * 6))) {
        const price = Math.round(base * (0.4 + rnd() * 2.2)) - 0.01
        insP.run(id, `${cat.slice(0, 3).toUpperCase()}-${String(id).padStart(5, '0')}`, `${brand} ${n}`, cat, brand, price, Math.floor(rnd() * 900))
        products.push({ id, price })
        id++
      }
})()
const insO = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?)')
const insI = db.prepare('INSERT INTO order_items VALUES (?,?,?,?)')
const start = Date.UTC(2023, 0, 1)
const span = Date.UTC(2026, 9, 21) - start
db.transaction(() => {
  for (let o = 1; o <= ORDERS; o++) {
    // growth curve + weekly seasonality
    const u = Math.sqrt(rnd())
    const ts = new Date(start + u * span)
    const n = 1 + Math.floor(rnd() * rnd() * 5)
    let total = 0
    for (let k = 0; k < n; k++) {
      const p = products[Math.floor(rnd() * products.length)]!
      const q = 1 + Math.floor(rnd() * rnd() * 3)
      total += p.price * q
      insI.run(o, p.id, q, p.price)
    }
    insO.run(o, 1 + Math.floor(rnd() * rnd() * NCUST), pick(STATUS), pick(CHANNEL), Math.round(total * 100) / 100, n, ts.toISOString().slice(0, 19))
  }
})()
db.exec(`
CREATE INDEX idx_orders_customer ON orders(customer_id);
UPDATE customers SET lifetime_value = t.v FROM (SELECT customer_id, ROUND(SUM(total),2) AS v FROM orders GROUP BY customer_id) AS t WHERE t.customer_id = customers.id;
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE VIEW monthly_revenue AS SELECT substr(created_at,1,7) AS month, COUNT(*) AS orders, ROUND(SUM(total),2) AS revenue FROM orders WHERE status NOT IN ('cancelled','refunded') GROUP BY month ORDER BY month;
CREATE VIEW top_customers AS SELECT c.id, c.name, c.country, c.lifetime_value FROM customers c ORDER BY c.lifetime_value DESC LIMIT 100;
`)
db.exec('PRAGMA wal_checkpoint(TRUNCATE); ANALYZE;')
const count = (t: string) => (db.query(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n
console.log(`wrote ${out}: ${count('customers').toLocaleString()} customers, ${count('products')} products, ${count('orders').toLocaleString()} orders, ${count('order_items').toLocaleString()} order_items in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
db.close()
