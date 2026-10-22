import { Assembly, C, TAU, ghost, glow, wire } from '../designers/kit'
import type { Animation, Geometry, MachineSpec, Vec3 } from '../spec/types'
import { fileScore, type Codebase, type CodeFile, type CodeModule } from './scan'

const LANG: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.rb': 'Ruby', '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP', '.vue': 'Vue', '.svelte': 'Svelte', '.zig': 'Zig', '.scala': 'Scala', '.dart': 'Dart', '.lua': 'Lua', '.ex': 'Elixir', '.exs': 'Elixir' }
const KIND_COLOR: Record<CodeFile['kind'], string> = { source: C.light, entry: C.yellow, test: C.green, types: C.cyan, config: C.gray }
const MOD_COLORS = [C.blue, C.cyan, C.green, C.yellow, C.orange, C.red, C.brass, C.light]
const HUB_RPM = 8
const FILES_PER_MODULE = 6

export const fmtLoc = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
export const moduleLabel = (path: string) => (path === '.' ? '(root)' : path.endsWith('/·') ? `${path.slice(0, -2)}/*` : path)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'

export interface CodeDesignOptions {
  /** Files changed since the last scan, drawn glowing with an electric arc. */
  hot?: Set<string>
}

/**
 * Turn a scanned codebase into a machine: the most depended-on module is the engine at the centre, every other top
 * module is a geared station driven from it by belts (ratio = pulley sizes), its biggest files stand on it as pistons,
 * springs (tests), beacons (entry points) and cells (types), and import traffic flows between stations as packets.
 */
export function designCodebase(cb: Codebase, opts: CodeDesignOptions = {}): MachineSpec {
  const a = new Assembly()
  const mods = cb.modules
  if (!mods.length) throw new Error('no modules to draw')
  const weight = (m: CodeModule) => cb.edges.reduce((s, e) => s + (e.to === m.path ? e.weight * 2 : e.from === m.path ? e.weight : 0), 0)
  const hub = [...mods].sort((x, y) => weight(y) - weight(x) || y.score - x.score)[0]!
  const order = [hub, ...mods.filter((m) => m !== hub)]
  const maxLoc = Math.max(...mods.map((m) => m.loc))
  const radiusOf = (m: CodeModule) => (m === hub ? 92 : 46) + 64 * Math.sqrt(m.loc / maxLoc)

  // Rings: up to 7 stations on the inner ring, the rest outside, spaced by their footprint.
  const pos = new Map<string, Vec3>()
  pos.set(hub.path, [0, 0, 0])
  const others = order.slice(1)
  const rings = others.length > 8 ? [others.slice(0, 7), others.slice(7)] : [others]
  let inner = radiusOf(hub) + 40
  rings.forEach((ring, ri) => {
    const need = ring.reduce((s, m) => s + radiusOf(m) * 2 + 56, 0) / TAU
    const maxR = Math.max(...ring.map(radiusOf))
    const R = Math.max(inner + maxR + 30, need)
    ring.forEach((m, k) => {
      const ang = (k / ring.length) * TAU + (ri ? Math.PI / ring.length : 0.35)
      pos.set(m.path, [Math.cos(ang) * R, 0, Math.sin(ang) * R])
    })
    inner = R + maxR
  })

  // Drive tree: breadth-first from the hub over import edges, so each station is belted to the module it talks to most.
  const parentOf = new Map<string, string>()
  const seen = new Set([hub.path])
  const queue = [hub.path]
  while (queue.length) {
    const cur = queue.shift()!
    const nbrs = cb.edges.filter((e) => e.from === cur || e.to === cur).map((e) => ({ m: e.from === cur ? e.to : e.from, w: e.weight })).sort((x, y) => y.w - x.w)
    for (const { m } of nbrs) if (!seen.has(m)) { seen.add(m); parentOf.set(m, cur); queue.push(m) }
  }
  const idOf = new Map(order.map((m, i) => [m.path, `mod-${i}-${slug(m.path)}`]))
  const pitch = new Map(order.map((m) => [m.path, radiusOf(m) * 0.36]))
  const teethOf = (m: CodeModule) => Math.max(12, Math.min(64, Math.round(14 + 44 * Math.sqrt(m.loc / maxLoc))))
  const hottest = [...mods].sort((x, y) => y.churn - x.churn)[0]!

  order.forEach((m, i) => {
    const id = idOf.get(m.path)!
    const P = pos.get(m.path)!
    const rb = radiusOf(m)
    const color = m === hub ? C.yellow : MOD_COLORS[(i - 1 + MOD_COLORS.length) % MOD_COLORS.length]!
    const imp = cb.edges.filter((e) => e.to === m.path).length
    const lang = topLanguage(m.files)
    a.add(id, moduleLabel(m.path), `${plural(m.files.length, 'file')} · ${fmtLoc(m.loc)} lines${lang ? ` of ${lang}` : ''} · imported by ${plural(imp, 'module')} · imports ${m.fanOut} · ${plural(m.churn, 'file change')} in the last ${cb.commits} commits.`, { type: 'cylinder', radius: rb, height: 10, segments: 48, hollow: rb - 5 }, ghost(color), { pos: P, explode: m === hub ? [0, -60, 0] : [P[0] * 0.55, 0, P[2] * 0.55] })

    // The station's gear: tooth count grows with its size; driven by its parent's gear through a belt.
    const z = teethOf(m)
    const pr = pitch.get(m.path)!
    const parent = parentOf.get(m.path)
    const gid = `${id}-gear`
    const ratio = parent ? pitch.get(parent)! / pr : undefined
    a.add(gid, `${moduleLabel(m.path)} · gear`, m === hub ? `The engine: the most depended-on module. Every other station is belted to it, directly or through the module it imports most.` : `Turns ${(ratio ?? 0.4).toFixed(2)}× its driver: belt pulley sizes follow lines of code, so small modules spin fast.`, { type: 'gear', teeth: z, module: (pr * 2) / z, thickness: m === hub ? 16 : 10, bore: Math.min(pr * 0.3, 8), spokes: 5 }, wire(color), {
      parent: id, pos: [0, 12, 0],
      anim: m === hub ? { type: 'rotate', axis: [0, 1, 0], rpm: HUB_RPM } : { type: 'rotate', axis: [0, 1, 0], drivenBy: parent ? `${idOf.get(parent)!}-gear` : `${idOf.get(hub.path)!}-gear`, ratio: ratio ?? 0.4 },
      explode: [0, 50, 0],
      note: m === hub ? `engine · imported by ${plural(imp, 'module')}` : undefined,
    })
    if (parent) a.connections.push({ from: `${idOf.get(parent)!}-gear`, to: gid, type: 'belt', radiusFrom: pitch.get(parent)!, radiusTo: pr, color: C.gray })

    // Biggest files stand around the gear.
    const files = m.files.slice(0, FILES_PER_MODULE)
    const maxF = Math.max(1, ...m.files.map((f) => f.loc))
    files.forEach((f, k) => {
      const ang = (k / files.length) * TAU + 0.4
      const rr = rb * 0.72
      const fp: Vec3 = [Math.cos(ang) * rr, 0, Math.sin(ang) * rr]
      const s = Math.sqrt(f.loc / maxF)
      const hot = opts.hot?.has(f.path)
      const col = hot ? C.orange : KIND_COLOR[f.kind]
      const desc = `${f.path} · ${fmtLoc(f.loc)} lines · imported by ${plural(f.importedBy, 'file')} · ${plural(f.churn, 'change')} recently${hot ? ' · just changed' : ''}.`
      const fid = `${id}-f${k}`
      const h = 14 + 86 * s
      let geo: Geometry
      let anim: Animation | undefined
      if (f.kind === 'test') {
        geo = { type: 'spring', radius: 6 + 4 * s, wire: 1.4, turns: 5 + Math.round(4 * s), height: h * 0.7 }
        anim = { type: 'oscillate', axis: [0, 1, 0], amplitude: 0.18, frequency: 2, driver: gid, phase: k * 60, mode: 'scale' }
      } else if (f.kind === 'entry') {
        geo = { type: 'cone', radius: 7 + 6 * s, height: h * 0.8, segments: 14 }
        anim = { type: 'oscillate', axis: [0, 1, 0], amplitude: 6, frequency: 1, driver: gid, phase: k * 60, mode: 'translate' }
      } else if (f.kind === 'types') {
        geo = { type: 'sphere', radius: 6 + 10 * s, segments: 12 }
        anim = { type: 'oscillate', axis: [0, 1, 0], amplitude: 4, frequency: 1, driver: gid, phase: k * 60, mode: 'translate' }
      } else if (f.kind === 'config') {
        geo = { type: 'box', size: [10 + 8 * s, 8 + 20 * s, 10 + 8 * s] }
        anim = undefined
      } else {
        geo = { type: 'cylinder', radius: 4 + 7 * s, height: h, segments: 12 }
        anim = { type: 'oscillate', axis: [0, 1, 0], amplitude: 4 + 8 * s, frequency: 1, driver: gid, phase: k * (360 / files.length), mode: 'translate', wave: 'cam' }
      }
      const y = geo.type === 'sphere' ? 6 + 10 * s + 6 : geo.type === 'box' ? (8 + 20 * s) / 2 + 5 : geo.type === 'spring' ? 5 : h / 2 + 5
      const mat = hot ? glow(col, { effect: 'electric', effectTarget: [-fp[0], 12 - y, -fp[2]] }) : f.kind === 'entry' ? glow(col) : wire(col)
      a.add(fid, f.path.split('/').pop()!, desc, geo, mat, { parent: id, pos: [fp[0], y, fp[2]], anim, explode: [fp[0] * 1.4, 40 + 30 * s, fp[2] * 1.4], note: hot ? 'just changed' : undefined })
    })
    if (m.files.length > files.length) a.annotations.push({ part: id, text: `+${m.files.length - files.length} more files` })
    if (m === hottest && m.churn > 0) a.add(`${id}-heat`, `${moduleLabel(m.path)} · hot spot`, `The most-edited module: ${plural(m.churn, 'file change')} in the last ${cb.commits} commits.`, { type: 'torus', radius: pr * 0.7, tube: 3, segments: 32 }, glow(C.orange, { effect: 'fire', effectTarget: [0, 1, 0] }), { parent: id, pos: [0, 26, 0], explode: [0, 80, 0], note: 'hot spot' })
  })

  // Import traffic: wires arc between stations and packets ride them, more packets for heavier edges.
  const flows = cb.edges.slice(0, Math.max(8, mods.length * 2))
  const maxW = Math.max(1, ...flows.map((e) => e.weight))
  flows.forEach((e, k) => {
    const A = pos.get(e.from)!, B = pos.get(e.to)!
    const ra = radiusOf(mods.find((m) => m.path === e.from)!), rbb = radiusOf(mods.find((m) => m.path === e.to)!)
    const d = norm2([B[0] - A[0], B[2] - A[2]])
    const start: Vec3 = [A[0] + d[0] * ra * 0.9, 18, A[2] + d[1] * ra * 0.9]
    const end: Vec3 = [B[0] - d[0] * rbb * 0.9, 18, B[2] - d[1] * rbb * 0.9]
    const arc = 0.22 + (k % 3) * 0.05
    const span = Math.hypot(end[0] - start[0], end[2] - start[2])
    const mid: Vec3 = [(start[0] + end[0]) / 2, 18 + span * arc, (start[2] + end[2]) / 2]
    const path: Vec3[] = Array.from({ length: 9 }, (_, j) => { const t = j / 8; return [0, 1, 2].map((c) => (1 - t) * (1 - t) * start[c]! + 2 * (1 - t) * t * mid[c]! + t * t * end[c]!) as Vec3 })
    const w = e.weight / maxW
    const anchorA = `flow-${k}-a`, anchorB = `flow-${k}-b`
    a.add(anchorA, `${moduleLabel(e.from)} → ${moduleLabel(e.to)}`, `${plural(e.weight, 'import')} from ${moduleLabel(e.from)} into ${moduleLabel(e.to)}.`, { type: 'sphere', radius: 2.5, segments: 6 }, wire(C.gray), { parent: idOf.get(e.from)!, pos: [start[0] - A[0], 18, start[2] - A[2]], explode: [0, 0, 0] })
    a.add(anchorB, `${moduleLabel(e.from)} → ${moduleLabel(e.to)}`, `${plural(e.weight, 'import')} from ${moduleLabel(e.from)} into ${moduleLabel(e.to)}.`, { type: 'sphere', radius: 2.5, segments: 6 }, wire(C.gray), { parent: idOf.get(e.to)!, pos: [end[0] - B[0], 18, end[2] - B[2]], explode: [0, 0, 0] })
    a.connections.push({ from: anchorA, to: anchorB, type: 'wire', arc, color: w > 0.5 ? C.cyan : C.gray })
    const n = 1 + Math.round(w * 2)
    for (let j = 0; j < n; j++) a.add(`flow-${k}-p${j}`, `import packet · ${moduleLabel(e.from)} → ${moduleLabel(e.to)}`, `${plural(e.weight, 'import')} flow this way; packet speed follows the engine clock.`, { type: 'sphere', radius: 3 + 3 * w, segments: 8 }, glow(w > 0.5 ? C.cyan : C.blue), { anim: { type: 'slide', path, driver: `${idOf.get(hub.path)!}-gear`, ratio: 0.5 + 0.25 * (k % 3), phase: j / n }, explode: [0, 0, 0] })
  })

  const extent = Math.max(...[...pos.values()].map((p) => Math.hypot(p[0], p[2]))) + 260
  const langs = cb.languages.slice(0, 2).map((l) => `${LANG[l.ext] ?? l.ext} ${Math.round((l.loc / Math.max(1, cb.totalLoc)) * 100)}%`).join(', ')
  const rest = cb.rest.modules ? ` · top ${mods.length} of ${mods.length + cb.rest.modules} modules` : ''
  return a.spec({ name: `${cb.name} · codebase`, description: `${plural(cb.files.length, 'file')} · ${fmtLoc(cb.totalLoc)} lines · ${langs}${rest} · belts = drive tree, packets = imports`, unit: 'mm', camera: { view: 'iso', yaw: -0.2, zoom: 1.05 } }, Math.ceil(extent))
}

function topLanguage(files: CodeFile[]): string | undefined {
  const m = new Map<string, number>()
  for (const f of files) { const l = LANG[f.ext]; if (l) m.set(l, (m.get(l) ?? 0) + f.loc) }
  return [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
}

function norm2(v: [number, number]): [number, number] { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l] }

export { fileScore }
