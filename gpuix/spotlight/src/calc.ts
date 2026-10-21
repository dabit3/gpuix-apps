/** Inline calculator and unit/currency converter. Pure: no I/O. */

type Unit = { dim: string; factor: number; label: string; offset?: number }

const U: Record<string, Unit> = {}
const def = (dim: string, factor: number, label: string, names: string[], offset?: number) => {
  for (const n of names) U[n] = { dim, factor, label, offset }
}
// Length (metres)
def('length', 0.001, 'mm', ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'])
def('length', 0.01, 'cm', ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'])
def('length', 1, 'm', ['m', 'meter', 'meters', 'metre', 'metres'])
def('length', 1000, 'km', ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'])
def('length', 0.0254, 'in', ['in', 'inch', 'inches', '"'])
def('length', 0.3048, 'ft', ['ft', 'foot', 'feet', "'"])
def('length', 0.9144, 'yd', ['yd', 'yard', 'yards'])
def('length', 1609.344, 'mi', ['mi', 'mile', 'miles'])
// Mass (grams)
def('mass', 1, 'g', ['g', 'gram', 'grams'])
def('mass', 1000, 'kg', ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'])
def('mass', 453.59237, 'lb', ['lb', 'lbs', 'pound', 'pounds'])
def('mass', 28.349523125, 'oz', ['oz', 'ounce', 'ounces'])
def('mass', 6350.29318, 'st', ['st', 'stone', 'stones'])
// Temperature (kelvin, factor + offset)
def('temp', 1, '°C', ['c', '°c', 'celsius'], 273.15)
def('temp', 5 / 9, '°F', ['f', '°f', 'fahrenheit'], 459.67 * (5 / 9))
def('temp', 1, 'K', ['k', 'kelvin'], 0)
// Data (bytes)
def('data', 1, 'B', ['b', 'byte', 'bytes'])
def('data', 1e3, 'KB', ['kb', 'kilobyte', 'kilobytes'])
def('data', 1e6, 'MB', ['mb', 'megabyte', 'megabytes'])
def('data', 1e9, 'GB', ['gb', 'gigabyte', 'gigabytes'])
def('data', 1e12, 'TB', ['tb', 'terabyte', 'terabytes'])
def('data', 1024 ** 2, 'MiB', ['mib'])
def('data', 1024 ** 3, 'GiB', ['gib'])
// Time (seconds)
def('time', 0.001, 'ms', ['ms', 'millisecond', 'milliseconds'])
def('time', 1, 's', ['s', 'sec', 'secs', 'second', 'seconds'])
def('time', 60, 'min', ['min', 'mins', 'minute', 'minutes'])
def('time', 3600, 'h', ['h', 'hr', 'hrs', 'hour', 'hours'])
def('time', 86400, 'days', ['d', 'day', 'days'])
def('time', 604800, 'weeks', ['wk', 'week', 'weeks'])
// Volume (litres)
def('volume', 0.001, 'ml', ['ml', 'milliliter', 'milliliters', 'millilitre'])
def('volume', 1, 'L', ['l', 'liter', 'liters', 'litre', 'litres'])
def('volume', 3.785411784, 'gal', ['gal', 'gallon', 'gallons'])
def('volume', 0.2365882365, 'cups', ['cup', 'cups'])
def('volume', 0.0295735295625, 'fl oz', ['floz', 'fl oz'])
// Speed (m/s)
def('speed', 1 / 3.6, 'km/h', ['kmh', 'km/h', 'kph'])
def('speed', 0.44704, 'mph', ['mph'])
def('speed', 1, 'm/s', ['m/s', 'mps'])
def('speed', 0.514444, 'kn', ['knot', 'knots', 'kn'])

/** Static reference rates: units of currency per 1 USD (snapshot, not live). */
export const USD_RATES: Record<string, number> = {
  usd: 1, eur: 0.92, gbp: 0.79, jpy: 151.2, cad: 1.37, aud: 1.52, chf: 0.88, cny: 7.24,
  inr: 83.4, mxn: 17.1, brl: 5.05, krw: 1365, sek: 10.6, nok: 10.8, sgd: 1.35, hkd: 7.82, nzd: 1.66,
}
const CURRENCY_ALIASES: Record<string, string> = {
  $: 'usd', dollar: 'usd', dollars: 'usd', '€': 'eur', euro: 'eur', euros: 'eur', '£': 'gbp',
  pound_sterling: 'gbp', '¥': 'jpy', yen: 'jpy', rupee: 'inr', rupees: 'inr', yuan: 'cny',
}
const SYMBOL: Record<string, string> = { usd: '$', eur: '€', gbp: '£', jpy: '¥', inr: '₹', cny: '¥', krw: '₩' }
for (const [code, rate] of Object.entries(USD_RATES)) def('currency', 1 / rate, code.toUpperCase(), [code])
for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) U[alias] = U[code]!

export interface CalcResult {
  /** Normalised expression shown on the left of the result card. */
  expression: string
  /** Formatted answer (what Enter copies). */
  value: string
  /** Small caption, e.g. "Length" or "Static rate · 1 USD = 0.92 EUR". */
  caption: string
}

// ── Expression evaluator (recursive descent) ─────────────────────────────────
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: Math.log10, sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), tan: (x) => Math.tan(x),
}
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 }

export function evaluate(src: string): number | null {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d{3}\b)/g, '').replace(/\s+/g, '')
  if (!s) return null
  let i = 0
  const peek = () => s[i]
  const eat = (c: string) => (s[i] === c ? (i++, true) : false)
  const expr = (): number => {
    let v = term()
    for (;;) {
      if (eat('+')) v += term()
      else if (eat('-')) v -= term()
      else return v
    }
  }
  const term = (): number => {
    let v = factor()
    for (;;) {
      if (eat('*')) v *= factor()
      else if (eat('/')) v /= factor()
      else if (s[i] === '%' && s[i + 1] !== undefined && /[\d(]/.test(s[i + 1]!)) (i++, (v %= factor()))
      else if (peek() === '(' || (peek() !== undefined && /[a-zπ]/i.test(peek()!))) v *= factor()
      else return v
    }
  }
  const factor = (): number => {
    let v = unary()
    if (eat('^')) v = v ** factor()
    return v
  }
  const unary = (): number => {
    if (eat('-')) return -unary()
    if (eat('+')) return unary()
    let v = atom()
    while (s[i] === '%' && !(s[i + 1] !== undefined && /[\d(]/.test(s[i + 1]!))) (i++, (v /= 100))
    if (s[i] === '!') {
      i++
      let f = 1
      for (let k = 2; k <= v; k++) f *= k
      v = f
    }
    return v
  }
  const atom = (): number => {
    if (eat('(')) {
      const v = expr()
      if (!eat(')')) throw new Error('paren')
      return v
    }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)
    if (num) {
      i += num[0].length
      return parseFloat(num[0])
    }
    const id = s.slice(i).match(/^[a-zπ]+/i)
    if (id) {
      const name = id[0].toLowerCase()
      if (FUNCS[name]) {
        i += name.length
        return FUNCS[name]!(atom())
      }
      if (CONSTS[name] !== undefined) {
        i += name.length
        return CONSTS[name]!
      }
    }
    throw new Error('token')
  }
  try {
    const v = expr()
    if (i !== s.length || !Number.isFinite(v)) return null
    return v
  } catch {
    return null
  }
}

export function formatNumber(v: number, maxFraction = 6): string {
  if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0)) return v.toExponential(4)
  return v.toLocaleString('en-US', { maximumFractionDigits: maxFraction })
}

const DIM_LABEL: Record<string, string> = {
  length: 'Length', mass: 'Mass', temp: 'Temperature', data: 'Data size', time: 'Duration',
  volume: 'Volume', speed: 'Speed', currency: 'Currency',
}

function convert(amount: number, from: Unit, to: Unit): number {
  const base = amount * from.factor + (from.offset ?? 0)
  return (base - (to.offset ?? 0)) / to.factor
}

function unitFor(raw: string): Unit | undefined {
  const k = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return U[k] ?? U[k.replace(/\s/g, '')]
}

/** Returns an inline answer for math ("12*(3+4)") and conversions ("12 usd in eur", "5 ft to cm"). */
export function calculate(input: string): CalcResult | null {
  const q = input.trim()
  if (!q || q.length > 120) return null

  // "20% of 150"
  const pct = q.match(/^(-?[\d.]+)\s*%\s*of\s+(.+)$/i)
  if (pct) {
    const base = evaluate(pct[2]!)
    if (base !== null) {
      const v = (parseFloat(pct[1]!) / 100) * base
      return { expression: `${pct[1]}% of ${formatNumber(base)}`, value: formatNumber(v), caption: 'Percentage' }
    }
  }

  // "<expr> <unit> in|to|as <unit>"
  const conv = q.match(/^(.+?)\s*([a-z$€£¥°"'/ ]+?)\s+(?:in|to|as|=)\s+([a-z$€£¥°"'/ ]+)$/i)
  if (conv) {
    const amount = evaluate(conv[1]!)
    const from = unitFor(conv[2]!)
    const to = unitFor(conv[3]!)
    if (amount !== null && from && to && from.dim === to.dim) {
      const v = convert(amount, from, to)
      const isCur = from.dim === 'currency'
      const code = to.label.toLowerCase()
      const value = isCur
        ? `${SYMBOL[code] ?? ''}${formatNumber(v, 2)}${SYMBOL[code] ? '' : ` ${to.label}`}`
        : `${formatNumber(v, 4)} ${to.label}`
      const caption = isCur
        ? `Static rate · 1 ${from.label} = ${formatNumber(convert(1, from, to), 4)} ${to.label}`
        : DIM_LABEL[from.dim]!
      return { expression: `${formatNumber(amount)} ${from.label} → ${to.label}`, value, caption }
    }
  }

  // Plain math. Needs an operator or function so "2026" alone stays a search.
  if (!/[\d)πe]\s*[-+*/^%×÷!]|^\s*[-(]|\b(sqrt|abs|round|floor|ceil|ln|log|sin|cos|tan|pi)\b|π/i.test(q)) return null
  const v = evaluate(q)
  if (v === null) return null
  return { expression: q.replace(/\*/g, '×').replace(/\//g, '÷'), value: formatNumber(v), caption: 'Calculator' }
}
