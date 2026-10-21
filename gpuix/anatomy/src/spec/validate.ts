import Ajv from 'ajv'
import schema from '../../schema/machine.schema.json'
import type { MachineSpec, Part } from './types'

export type IssueCode = 'schema' | 'duplicate-id' | 'orphan-parent' | 'parent-cycle' | 'missing-ref' | 'driven-cycle' | 'nan' | 'out-of-bounds' | 'degenerate'

export interface Issue { code: IssueCode; path: string; message: string }

const ajv = new Ajv({ allErrors: true, strict: false })
const check = ajv.compile(schema)

/** AJV schema validation plus the mechanical checks a schema can't express. Returns [] when the spec is valid. */
export function validate(input: unknown): Issue[] {
  const issues: Issue[] = []
  // NaN/Infinity can't come from JSON, but designers and hand-edited JS objects can produce them.
  findNaN(input, '', issues)
  if (!check(input)) {
    const seen = new Set<string>()
    for (const e of check.errors ?? []) {
      // oneOf failures repeat once per branch; keep the most useful line per path.
      const key = e.instancePath + e.keyword
      if (seen.has(key) || e.keyword === 'if') continue
      seen.add(key)
      issues.push({ code: 'schema', path: e.instancePath || '/', message: `${e.message ?? 'invalid'}${e.params && 'allowedValue' in e.params ? ` (${String(e.params.allowedValue)})` : ''}` })
    }
    return issues
  }
  const spec = input as unknown as MachineSpec
  const ids = new Map<string, number>()
  spec.parts.forEach((p, i) => {
    if (ids.has(p.id)) issues.push({ code: 'duplicate-id', path: `/parts/${i}/id`, message: `duplicate part id "${p.id}"` })
    else ids.set(p.id, i)
  })
  const byId = new Map(spec.parts.map((p) => [p.id, p] as const))
  const ref = (path: string, id: string | undefined, what: string) => {
    if (id !== undefined && !byId.has(id)) issues.push({ code: 'missing-ref', path, message: `${what} "${id}" does not exist` })
  }
  spec.parts.forEach((p, i) => {
    if (p.parentId !== undefined && !byId.has(p.parentId)) issues.push({ code: 'orphan-parent', path: `/parts/${i}/parentId`, message: `parent "${p.parentId}" of "${p.id}" does not exist` })
    const a = p.animation
    if (a?.type === 'rotate') {
      ref(`/parts/${i}/animation/drivenBy`, a.drivenBy, 'driver')
      if (a.drivenBy === undefined && a.rpm === undefined) issues.push({ code: 'schema', path: `/parts/${i}/animation`, message: `rotate on "${p.id}" needs rpm or drivenBy` })
    }
    if (a?.type === 'oscillate') ref(`/parts/${i}/animation/driver`, a.driver, 'driver')
    if (a?.type === 'slide') ref(`/parts/${i}/animation/driver`, a.driver, 'driver')
    if (a?.type === 'crank') {
      ref(`/parts/${i}/animation/crank`, a.crank, 'crank')
      const c = byId.get(a.crank)
      if (c && c.animation?.type !== 'rotate') issues.push({ code: 'missing-ref', path: `/parts/${i}/animation/crank`, message: `crank "${a.crank}" must have a rotate animation` })
    }
    if (a?.type === 'rod') {
      ref(`/parts/${i}/animation/piston`, a.piston, 'piston')
      const pp = byId.get(a.piston)
      if (pp && pp.animation?.type !== 'crank') issues.push({ code: 'missing-ref', path: `/parts/${i}/animation/piston`, message: `rod piston "${a.piston}" must have a crank animation` })
    }
    if (a?.type === 'follow') ref(`/parts/${i}/animation/part`, a.part, 'followed part')
    if (p.material.pulse) ref(`/parts/${i}/material/pulse/driver`, p.material.pulse.driver, 'pulse driver')
    const g = p.geometry
    if (g.type === 'cylinder' && g.hollow !== undefined && g.hollow >= g.radius) issues.push({ code: 'degenerate', path: `/parts/${i}/geometry/hollow`, message: `hollow ${g.hollow} must be smaller than radius ${g.radius}` })
    if (g.type === 'gear' && g.bore !== undefined && g.bore >= (g.module * (g.teeth - 2.5)) / 2) issues.push({ code: 'degenerate', path: `/parts/${i}/geometry/bore`, message: `bore ${g.bore} is larger than the gear's root circle` })
    if (g.type === 'spring' && g.wire * g.turns > g.height * 1.05) issues.push({ code: 'degenerate', path: `/parts/${i}/geometry`, message: `spring coils overlap: wire × turns (${(g.wire * g.turns).toFixed(2)}) exceeds height ${g.height}` })
  })
  for (const [k, c] of (spec.connections ?? []).entries()) { ref(`/connections/${k}/from`, c.from, 'connection end'); ref(`/connections/${k}/to`, c.to, 'connection end') }
  for (const [k, n] of (spec.annotations ?? []).entries()) ref(`/annotations/${k}/part`, n.part, 'annotated part')
  // Parent cycles.
  for (const [i, p] of spec.parts.entries()) {
    const seen = new Set<string>([p.id])
    let cur = p.parentId
    while (cur !== undefined && byId.has(cur)) {
      if (seen.has(cur)) { issues.push({ code: 'parent-cycle', path: `/parts/${i}/parentId`, message: `parent chain of "${p.id}" loops back to "${cur}"` }); break }
      seen.add(cur)
      cur = byId.get(cur)!.parentId
    }
  }
  // Driver cycles: drivenBy / oscillate.driver / slide.driver / crank / rod / follow / pulse edges must form a DAG.
  const deps = (p: Part): string[] => {
    const a = p.animation, out: string[] = []
    if (a?.type === 'rotate' && a.drivenBy) out.push(a.drivenBy)
    if ((a?.type === 'oscillate' || a?.type === 'slide') && a.driver) out.push(a.driver)
    if (a?.type === 'crank') out.push(a.crank)
    if (a?.type === 'rod') out.push(a.piston)
    if (a?.type === 'follow') out.push(a.part)
    return out.filter((d) => byId.has(d))
  }
  const state = new Map<string, 1 | 2>()
  const reported = new Set<string>()
  const visit = (id: string, chain: string[]) => {
    const s = state.get(id)
    if (s === 2) return
    if (s === 1) {
      const loop = chain.slice(chain.indexOf(id))
      const key = [...loop].sort().join(',')
      if (!reported.has(key)) { reported.add(key); issues.push({ code: 'driven-cycle', path: `/parts/${ids.get(id)}/animation`, message: `drive cycle: ${[...loop, id].join(' → ')}` }) }
      return
    }
    state.set(id, 1)
    for (const d of deps(byId.get(id)!)) visit(d, [...chain, id])
    state.set(id, 2)
  }
  for (const p of spec.parts) visit(p.id, [])
  // Bounds: every part's local origin chained through parent positions must stay inside the declared box.
  const bound = spec.bounds ?? 1e4
  for (const [i, p] of spec.parts.entries()) {
    let x = 0, y = 0, z = 0, cur: Part | undefined = p, guard = 0
    while (cur && guard++ < 64) {
      const q = cur.transform?.position
      if (q) { x += q[0]; y += q[1]; z += q[2] }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
    if (m > bound) issues.push({ code: 'out-of-bounds', path: `/parts/${i}/transform/position`, message: `"${p.id}" sits ${m.toFixed(1)} from the origin, outside bounds ±${bound}` })
  }
  return issues
}

function findNaN(v: unknown, path: string, out: Issue[]) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push({ code: 'nan', path: path || '/', message: `${v} is not a finite number` }); return }
  if (Array.isArray(v)) { v.forEach((x, i) => findNaN(x, `${path}/${i}`, out)); return }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) findNaN(x, `${path}/${k}`, out)
}

/** Parse JSON text, mapping NaN-ish tokens so hand-edited specs with `NaN` report a clear `nan` issue. */
export function parseSpec(text: string): { spec?: MachineSpec; issues: Issue[] } {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/:\s*(-?Infinity|NaN)\b/g, ': "__$1__"').replace(/([[,]\s*)(-?Infinity|NaN)\b/g, '$1"__$2__"'), (_k, v) => (typeof v === 'string' && /^__(-?Infinity|NaN)__$/.test(v) ? Number(v.slice(2, -2)) : v))
  } catch (e) {
    return { issues: [{ code: 'schema', path: '/', message: `invalid JSON: ${(e as Error).message}` }] }
  }
  const issues = validate(data)
  return issues.length ? { issues } : { spec: data as MachineSpec, issues }
}
