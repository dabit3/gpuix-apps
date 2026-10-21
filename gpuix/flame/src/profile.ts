// V8 / Bun / Node `.cpuprofile` model: frames, weighted stacks, and the cell
// layouts the flamegraph paints. All times are microseconds.
import { fileURLToPath } from 'node:url'

export type FrameKind = 'root' | 'user' | 'runtime' | 'native' | 'regexp' | 'gc' | 'idle'

export type Frame = {
  key: string
  name: string
  url: string
  /** Absolute path for file:// frames, else ''. */
  file: string
  /** 1-based, 0 when unknown. */
  line: number
  col: number
  kind: FrameKind
}

/** One rectangle in a flamegraph. `start`/`end` are on the layout's time axis. */
export type Cell = {
  id: number
  frame: number
  depth: number
  start: number
  end: number
  self: number
  parent: number
}

export type Layout = {
  cells: Cell[]
  /** Cells per depth, sorted by start: for hit testing. */
  rows: Cell[][]
  depth: number
  total: number
}

export type Stack = { stack: number[]; weight: number }

export type Profile = {
  path: string
  frames: Frame[]
  /** Unique stacks (root → leaf frame indexes, excluding the root) with summed weight. */
  stacks: Stack[]
  /** Per-sample stack index into `stacks` and weight, in time order. */
  timeline: { stack: number; weight: number }[]
  total: number
  sampleCount: number
  intervalUs: number
  startTime: number
}

type RawNode = {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId?: string }
  children?: number[]
  parent?: number
}

type RawProfile = {
  nodes: RawNode[]
  samples: number[]
  timeDeltas: number[]
  startTime: number
  endTime: number
}

export const ROOT_FRAME = 0

function frameKind(name: string, url: string): FrameKind {
  if (name === '(garbage collector)') return 'gc'
  if (name === '(idle)') return 'idle'
  if (name.startsWith('(') && name !== '(module)' && name !== '(anonymous)') return 'native'
  if (name.startsWith('/') && !url) return 'regexp'
  if (!url) return 'native'
  if (/^(node|bun|internal):/.test(url) || url.startsWith('builtin')) return 'runtime'
  return 'user'
}

export function parseCpuProfile(json: unknown, path = ''): Profile {
  const raw = json as RawProfile
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.samples)) {
    throw new Error('not a .cpuprofile: expected { nodes, samples, timeDeltas }')
  }
  const name = path.split('/').pop() || 'profile'
  const frames: Frame[] = [{ key: '(all)', name: `all · ${name}`, url: '', file: '', line: 0, col: 0, kind: 'root' }]
  const frameIndex = new Map<string, number>()
  const nodes = new Map<number, RawNode>()
  for (const n of raw.nodes) nodes.set(n.id, n)
  for (const n of raw.nodes) for (const c of n.children ?? []) {
    const child = nodes.get(c)
    if (child) child.parent = n.id
  }

  const nodeFrame = new Map<number, number>()
  for (const n of raw.nodes) {
    const cf = n.callFrame
    if (cf.functionName === '(root)') {
      nodeFrame.set(n.id, ROOT_FRAME)
      continue
    }
    const fname = cf.functionName || '(anonymous)'
    const key = `${fname}\u0000${cf.url}\u0000${cf.lineNumber}\u0000${cf.columnNumber}`
    let idx = frameIndex.get(key)
    if (idx === undefined) {
      let file = ''
      if (cf.url.startsWith('file://')) {
        try {
          file = fileURLToPath(cf.url)
        } catch {}
      } else if (cf.url.startsWith('/')) file = cf.url
      idx = frames.length
      frames.push({
        key,
        name: fname,
        url: cf.url,
        file,
        line: cf.lineNumber >= 0 ? cf.lineNumber + 1 : 0,
        col: cf.columnNumber >= 0 ? cf.columnNumber + 1 : 0,
        kind: frameKind(fname, cf.url),
      })
      frameIndex.set(key, idx)
    }
    nodeFrame.set(n.id, idx)
  }

  // Stack per node, memoized through the parent chain.
  const nodeStack = new Map<number, number>()
  const stacks: Stack[] = []
  const stackOf = (id: number): number => {
    const hit = nodeStack.get(id)
    if (hit !== undefined) return hit
    const chain: number[] = []
    for (let cur: RawNode | undefined = nodes.get(id); cur; cur = cur.parent ? nodes.get(cur.parent) : undefined) {
      const f = nodeFrame.get(cur.id)!
      if (f !== ROOT_FRAME) chain.push(f)
    }
    chain.reverse()
    const idx = stacks.length
    stacks.push({ stack: chain, weight: 0 })
    nodeStack.set(id, idx)
    return idx
  }

  const deltas = raw.timeDeltas ?? []
  const timeline: { stack: number; weight: number }[] = []
  const positive = deltas.filter((d) => d > 0).sort((a, b) => a - b)
  const interval = positive.length ? positive[Math.floor(positive.length / 2)]! : 1000
  let total = 0
  for (let i = 0; i < raw.samples.length; i++) {
    const next = deltas[i + 1]
    const weight = Math.max(0, next === undefined ? interval : next)
    const s = stackOf(raw.samples[i]!)
    stacks[s]!.weight += weight
    timeline.push({ stack: s, weight })
    total += weight
  }

  return {
    path,
    frames,
    stacks,
    timeline,
    total,
    sampleCount: raw.samples.length,
    intervalUs: interval,
    startTime: raw.startTime,
  }
}

type TreeNode = { frame: number; total: number; self: number; children: Map<number, TreeNode> }

function newNode(frame: number): TreeNode {
  return { frame, total: 0, self: 0, children: new Map() }
}

/** Merges stacks into a call tree rooted at `rootFrame`. */
export function buildTree(stacks: Stack[], rootFrame = ROOT_FRAME): TreeNode {
  const root = newNode(rootFrame)
  for (const { stack, weight } of stacks) {
    if (weight <= 0) continue
    root.total += weight
    let cur = root
    for (const f of stack) {
      let next = cur.children.get(f)
      if (!next) cur.children.set(f, (next = newNode(f)))
      next.total += weight
      cur = next
    }
    cur.self += weight
  }
  return root
}

function finish(cells: Cell[], total: number): Layout {
  const rows: Cell[][] = []
  let depth = 0
  for (const c of cells) {
    ;(rows[c.depth] ??= []).push(c)
    depth = Math.max(depth, c.depth + 1)
  }
  for (const r of rows) r?.sort((a, b) => a.start - b.start)
  for (let i = 0; i < depth; i++) rows[i] ??= []
  return { cells, rows, depth, total }
}

/** Left-heavy: identical stacks merged, heaviest child first. */
export function layoutTree(root: TreeNode): Layout {
  const cells: Cell[] = []
  const walk = (node: TreeNode, depth: number, start: number, parent: number) => {
    const id = cells.length
    cells.push({ id, frame: node.frame, depth, start, end: start + node.total, self: node.self, parent })
    let x = start
    const kids = [...node.children.values()].sort((a, b) => b.total - a.total || a.frame - b.frame)
    for (const k of kids) {
      walk(k, depth + 1, x, id)
      x += k.total
    }
  }
  walk(root, 0, 0, -1)
  return finish(cells, root.total)
}

export function layoutLeftHeavy(p: Profile): Layout {
  return layoutTree(buildTree(p.stacks))
}

/** Time-ordered: samples in order, consecutive identical frames merged. */
export function layoutTimeOrder(p: Profile): Layout {
  const cells: Cell[] = []
  const open: Cell[] = []
  const root: Cell = { id: 0, frame: ROOT_FRAME, depth: 0, start: 0, end: p.total, self: 0, parent: -1 }
  cells.push(root)
  open.push(root)
  let t = 0
  for (const s of p.timeline) {
    if (s.weight <= 0) continue
    const stack = p.stacks[s.stack]!.stack
    // Keep the shared prefix open, close the rest.
    let keep = 1
    while (keep < open.length && keep - 1 < stack.length && open[keep]!.frame === stack[keep - 1]) keep++
    open.length = keep
    for (let d = keep - 1; d < stack.length; d++) {
      const c: Cell = { id: cells.length, frame: stack[d]!, depth: d + 1, start: t, end: t, self: 0, parent: open[open.length - 1]!.id }
      cells.push(c)
      open.push(c)
    }
    t += s.weight
    for (const c of open) c.end = t
    open[open.length - 1]!.self += s.weight
  }
  if (open.length === 1) root.self = p.total
  return finish(cells, p.total)
}

export type FunctionStat = { frame: number; self: number; total: number }

/** Self and total time per function; recursion counts once per sample. */
export function topFunctions(p: Profile): FunctionStat[] {
  const self = new Map<number, number>()
  const total = new Map<number, number>()
  for (const { stack, weight } of p.stacks) {
    if (weight <= 0 || stack.length === 0) continue
    const leaf = stack[stack.length - 1]!
    self.set(leaf, (self.get(leaf) ?? 0) + weight)
    for (const f of new Set(stack)) total.set(f, (total.get(f) ?? 0) + weight)
  }
  return [...total.entries()]
    .map(([frame, t]) => ({ frame, self: self.get(frame) ?? 0, total: t }))
    .sort((a, b) => b.self - a.self || b.total - a.total)
}

/** Callers (frame at depth 0, callers above it) and callees of one function. */
export function sandwich(p: Profile, frame: number): { callers: Layout; callees: Layout } {
  const up: Stack[] = []
  const down: Stack[] = []
  for (const { stack, weight } of p.stacks) {
    const first = stack.indexOf(frame)
    if (first < 0 || weight <= 0) continue
    const last = stack.lastIndexOf(frame)
    down.push({ stack: stack.slice(first + 1), weight })
    up.push({ stack: stack.slice(0, last).reverse(), weight })
  }
  return { callers: layoutTree(buildTree(up, frame)), callees: layoutTree(buildTree(down, frame)) }
}

export function matchesQuery(f: Frame, q: string): boolean {
  if (!q) return false
  const needle = q.toLowerCase()
  return f.name.toLowerCase().includes(needle) || (f.file && f.file.toLowerCase().includes(needle)) || false
}

/** Share of samples that have any frame matching the query. */
export function matchedTime(p: Profile, q: string): number {
  if (!q) return 0
  const hit = p.frames.map((f) => matchesQuery(f, q))
  let t = 0
  for (const { stack, weight } of p.stacks) if (stack.some((f) => hit[f])) t += weight
  return t
}

export function formatTime(us: number): string {
  if (us >= 1e6) return `${(us / 1e6).toFixed(2)} s`
  if (us >= 1e4) return `${(us / 1e3).toFixed(0)} ms`
  if (us >= 1e3) return `${(us / 1e3).toFixed(1)} ms`
  return `${Math.round(us)} µs`
}

export function shortFile(f: Frame): string {
  if (!f.file && !f.url) return f.kind === 'regexp' ? 'regexp' : 'native'
  const parts = (f.file || f.url).split('/')
  return parts.slice(-2).join('/')
}

export function frameLocation(f: Frame): string {
  const file = shortFile(f)
  return f.line ? `${file}:${f.line}` : file
}
