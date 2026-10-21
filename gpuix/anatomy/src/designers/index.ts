import { engine } from './engine'
import { locomotive, planetary, turbofan, watch } from './machines'
import type { MachineSpec } from '../spec/types'

export { slugify } from './kit'

const NUM: Record<string, number> = { single: 1, one: 1, two: 2, twin: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12 }

/** Built-in designers: turn a one-line description into a spec without a model. Returns null when nothing matches. */
export function design(prompt: string): MachineSpec | null {
  const p = prompt.toLowerCase()
  const v = p.match(/\bv[- ]?(\d{1,2})\b/)
  if (v) return engine({ layout: 'v', cylinders: +v[1]!, prompt })
  const inl = p.match(/\b(?:inline|straight|i)[- ]?(\d{1,2})\b/) ?? p.match(/\b(\d{1,2})[- ]cyl/)
  const word = p.match(/\b(single|one|two|twin|three|four|five|six|eight|ten|twelve)[- ]cylinder/)
  const flat = /\b(flat|boxer)\b/.test(p)
  if (flat) return engine({ layout: 'flat', cylinders: +(p.match(/(\d{1,2})/)?.[1] ?? 4), prompt })
  if (inl) return engine({ layout: 'inline', cylinders: +inl[1]!, prompt })
  if (word) return engine({ layout: 'inline', cylinders: NUM[word[1]!]!, prompt })
  if (/\b(engine|motor)\b/.test(p) && !/jet|turbo|steam/.test(p)) return engine({ layout: 'inline', cylinders: 4, prompt })
  if (/watch|clock|movement|escapement|horolog/.test(p)) return watch(prompt)
  if (/turbofan|jet|turbine|turbojet/.test(p)) return turbofan(prompt)
  if (/locomotive|steam|train/.test(p)) return locomotive(prompt)
  if (/planet|gearbox|gear ?set|transmission|reduction|gears?\b/.test(p)) return planetary(prompt)
  return null
}

export const DESIGNERS = ['V8 / V6 / V12 engines', 'inline-N engines', 'flat/boxer engines', 'mechanical watch', 'turbofan', 'steam locomotive', 'planetary gearset']
