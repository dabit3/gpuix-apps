import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, useWindowSize, type ImgInstance } from '@gpuix/react'
import { Sim, type LinkRect, type Rect } from './sim'
import { Raster, drawScene } from './raster'
import { fetchPage, mockSerp, words, type Block, type Page } from './page'
import { listen, type Command } from './ipc'
import { writeFileSync } from 'node:fs'

const STATE_FILE = process.env.CRAWLER_STATE

export const C = {
  bg: '#0a0c10',
  panel: '#11151b',
  border: '#272b33',
  fg: '#f0f3f6',
  text: '#d9dee3',
  muted: '#9ea7b3',
  dim: '#7a828e',
  blue: '#71b7ff',
  green: '#26cd4d',
  amber: '#f0b72f',
  red: '#ff9492',
  cyan: '#39c5cf',
}

const HEADER = 52
const FOOTER = 34

type Props = { url?: string; spiders?: number; still?: boolean; chaos?: boolean; ipc?: boolean; seed?: number; animate?: boolean; onFrame?: (fps: number) => void }

type Measured = { lines: Rect[]; links: LinkRect[]; pageH: number }

export function App(props: Props) {
  const renderer = useGpuixRequired()
  const win = useWindowSize()
  const simRef = useRef<Sim>(null as unknown as Sim)
  if (!simRef.current) {
    simRef.current = new Sim(props.seed ?? 7)
    simRef.current.still = !!props.still
    simRef.current.chaos = !!props.chaos
  }
  const sim = simRef.current
  const [page, setPage] = useState<Page>(() => (props.url ? { url: props.url, title: 'Crawling…', blocks: [{ kind: 'p', segs: [{ text: `Fetching ${props.url}` }] }] } : mockSerp()))
  const [loading, setLoading] = useState(!!props.url)
  const history = useRef<Page[]>([])
  const [scrollY, setScrollY] = useState(0)
  const scrollRef = useRef(0)
  const [hud, setHud] = useState('')
  const [modes, setModes] = useState({ follow: false, still: !!props.still, chaos: !!props.chaos })
  const img = useRef<ImgInstance>(null)
  const wrapRef = useRef<{ id: number } | null>(null)
  const vpRef = useRef<{ id: number } | null>(null)
  const wordRefs = useRef(new Map<string, { id: number }>())
  const measured = useRef<Measured>({ lines: [], links: [], pageH: 0 })
  const cache = useRef(new Map<string, Rect>())
  const vp = useRef({ x: 0, y: HEADER, w: Math.max(100, win.width), h: Math.max(100, win.height - HEADER - FOOTER) })
  const raster = useRef(new Raster(vp.current.w, vp.current.h))
  const fps = useRef(0)

  const narrow = win.width < 760
  const padX = narrow ? 22 : Math.min(150, Math.max(40, (win.width - 760) / 2))

  // ---- page navigation
  const navigate = useCallback(async (url: string, push = true) => {
    setLoading(true)
    const p = await fetchPage(url)
    setPage((old) => {
      if (push) history.current.push(old)
      return p
    })
    setLoading(false)
  }, [])
  useEffect(() => {
    if (props.url) void navigate(props.url, false)
  }, [])
  const back = useCallback(() => {
    const prev = history.current.pop()
    if (prev) setPage(prev)
    else if (page.url.startsWith('http')) setPage(mockSerp())
  }, [page])
  useEffect(() => {
    sim.onFollowLink = (l) => void navigate(l.href)
  }, [navigate])

  // reset per-page state
  useEffect(() => {
    sim.indexed.clear()
    sim.scans.clear()
    sim.links = []
    sim.lines = []
    cache.current.clear()
    scrollRef.current = 0
    setScrollY(0)
    for (const s of sim.spiders) s.state = 'wander'
  }, [page])

  // ---- measuring the walkable surface (cached; refreshed on resize / scroll / page change)
  const measure = useCallback(() => {
    const wrap = wrapRef.current && renderer.getElementBounds?.(wrapRef.current.id)
    const v = vpRef.current && renderer.getElementBounds?.(vpRef.current.id)
    if (!wrap || !v) return false
    vp.current = { x: v.x, y: v.y, w: Math.round(v.width), h: Math.round(v.height) }
    for (const [key, inst] of wordRefs.current) {
      const b = renderer.getElementBounds?.(inst.id)
      if (b && b.width > 0) cache.current.set(key, { x: b.x - wrap.x, y: b.y - wrap.y, w: b.width, h: b.height })
    }
    // group into lines (per block, per row) and links (per run, first row)
    const lineMap = new Map<string, Rect>()
    const linkMap = new Map<string, LinkRect>()
    for (const [key, r] of cache.current) {
      const [bi, wi, run, href] = key.split('|')
      const lk = `${bi}|${Math.round(r.y / 4)}`
      const L = lineMap.get(lk)
      if (L) {
        const x1 = Math.max(L.x + L.w, r.x + r.w)
        L.x = Math.min(L.x, r.x)
        L.w = x1 - L.x
      } else lineMap.set(lk, { ...r })
      if (run && href) {
        const id = `${bi}|${run}`
        const K = linkMap.get(id)
        if (!K) linkMap.set(id, { ...r, id, href, text: '' })
        else if (Math.abs(K.y - r.y) < 3) {
          const x1 = Math.max(K.x + K.w, r.x + r.w)
          K.x = Math.min(K.x, r.x)
          K.w = x1 - K.x
        } else if (r.y < K.y) Object.assign(K, { x: r.x, y: r.y, w: r.w, h: r.h })
      }
      void wi
    }
    measured.current = { lines: [...lineMap.values()], links: [...linkMap.values()], pageH: wrap.height }
    sim.setSurface(measured.current.lines, measured.current.links, { w: vp.current.w, h: wrap.height })
    return true
  }, [renderer])

  useEffect(() => {
    cache.current.clear()
    const ids = [60, 250, 600].map((ms) => setTimeout(measure, ms))
    return () => ids.forEach(clearTimeout)
  }, [page, win.width, win.height, measure])
  useEffect(() => {
    const id = setTimeout(measure, 80)
    return () => clearTimeout(id)
  }, [scrollY, measure])

  // ---- initial spiders
  useEffect(() => {
    const n = props.spiders ?? 1
    const ids = Array.from({ length: n }, (_, i) => setTimeout(() => sim.dropSpider(), 450 + i * 650))
    return () => ids.forEach(clearTimeout)
  }, [])

  // ---- IPC from other panes: `crawler feed 5`, `crawler spawn`, ...
  useEffect(() => {
    if (!props.ipc) return
    const server = listen((c: Command) => {
      if (c.cmd === 'feed') sim.feed(Math.min(40, c.n))
      else if (c.cmd === 'spawn') for (let i = 0; i < Math.min(8, c.n); i++) setTimeout(() => sim.dropSpider(), i * 350)
      else if (c.cmd === 'web') sim.buildWeb()
      else if (c.cmd === 'open') void navigate(c.url)
      else if (c.cmd === 'still') { sim.still = c.on; setModes((m) => ({ ...m, still: c.on })) }
    })
    return () => { server.close() }
  }, [])

  // ---- the single animation loop: fixed-step sim + CPU raster -> <img>.setImagePixels
  useEffect(() => {
    let last = performance.now()
    let frames = 0, fpsT = last
    if (props.animate === false) return
    const id = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const { w, h } = vp.current
      sim.view = { scrollY: scrollRef.current, w, h }
      sim.step(dt)
      const r = raster.current
      r.resize(w, h)
      drawScene(r, sim, 0, scrollRef.current)
      img.current?.setImagePixels(w, h, r.buf)
      frames++
      if (STATE_FILE && frames % 6 === 0) {
        const v = vp.current, sy = scrollRef.current
        writeFileSync(STATE_FILE, JSON.stringify({ vp: v, scrollY: sy, spiders: sim.spiders.map((sp) => ({ id: sp.id, state: sp.state, x: Math.round(sp.x + v.x), y: Math.round(sp.y - sy + v.y) })) }))
      }
      if (now - fpsT > 1000) {
        fps.current = (frames * 1000) / (now - fpsT)
        frames = 0
        fpsT = now
        props.onFrame?.(fps.current)
      }
      const sig = `${sim.spiders.length}|${sim.indexed.size}|${sim.stats.eaten}|${sim.toasts.map((t) => t.id).join(',')}|${Math.round(fps.current)}`
      setHud((old) => (old === sig ? old : sig))
    }, 16)
    return () => clearInterval(id)
  }, [])

  // ---- input
  const toDoc = (x: number, y: number) => ({ x: x - vp.current.x, y: y - vp.current.y + scrollRef.current })
  const scrollBy = (dy: number) => {
    const max = Math.max(0, measured.current.pageH - vp.current.h + 40)
    const next = Math.max(0, Math.min(max, scrollRef.current + dy))
    if (next !== scrollRef.current) {
      scrollRef.current = next
      setScrollY(next)
    }
  }
  const onKey = (e: { key?: string; keyChar?: string | null; modifiers?: { ctrl?: boolean; cmd?: boolean } }) => {
    if (e.modifiers?.ctrl || e.modifiers?.cmd) return
    const raw = e.keyChar && e.keyChar.trim() ? e.keyChar : e.key ?? ''
    const k = raw.length === 1 ? raw.toLowerCase() : raw
    switch (k) {
      case 'f': sim.feed(3); break
      case 's': sim.dropSpider(); break
      case 'w': sim.buildWeb(); break
      case 'c': sim.follow = !sim.follow; setModes((m) => ({ ...m, follow: sim.follow })); break
      case 'r': sim.still = !sim.still; setModes((m) => ({ ...m, still: sim.still })); break
      case 'x': sim.chaos = !sim.chaos; setModes((m) => ({ ...m, chaos: sim.chaos })); break
      case 'b': case 'backspace': back(); break
      case 'j': case 'down': scrollBy(60); break
      case 'k': case 'up': scrollBy(-60); break
      case 'space': case ' ': case 'pagedown': scrollBy(vp.current.h * 0.8); break
      case 'pageup': scrollBy(-vp.current.h * 0.8); break
      case 'g': case 'home': scrollBy(-1e9); break
    }
  }

  const [, , , toastIds] = hud.split('|')
  void toastIds
  const toasts = sim.toasts
  const linkCount = measured.current.links.length

  return (
    <div
      tabIndex={-1}
      autoFocus
      onKeyDown={onKey}
      onScroll={(e) => scrollBy(-(e.deltaY ?? 0) * (e.precise ? 1 : 40))}
      onMouseMove={(e) => { sim.cursor = toDoc(e.x ?? 0, e.y ?? 0) }}
      onMouseLeave={() => { sim.cursor = null }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const p = toDoc(e.x ?? 0, e.y ?? 0)
        if (p.y < scrollRef.current || p.y > scrollRef.current + vp.current.h) return
        if (!sim.poke(p.x, p.y)) sim.addFly(p.x, p.y)
      }}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: C.bg }}
    >
      <Header page={page} loading={loading} sim={sim} modes={modes} narrow={narrow} fps={fps.current} />
      <div ref={vpRef as never} style={{ display: 'flex', flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={wrapRef as never} style={{ position: 'absolute', left: 0, top: -scrollY, width: '100%', display: 'flex', flexDirection: 'column', paddingLeft: padX, paddingRight: padX, paddingTop: 22, paddingBottom: 120, pointerEvents: 'none' }}>
          <PageView page={page} indexed={sim.indexed} nIndexed={sim.indexed.size} wordRefs={wordRefs.current} narrow={narrow} />
        </div>
        <img ref={img} objectFit="fill" style={{ position: 'absolute', left: 0, top: 0, width: vp.current.w, height: vp.current.h, pointerEvents: 'none' }} />
        {toasts.map((t) => (
          <div key={t.id} style={{ position: 'absolute', left: Math.max(8, Math.min(vp.current.w - 230, t.x - 40)), top: t.y - scrollY - 30, display: 'flex', paddingLeft: 9, paddingRight: 9, paddingTop: 4, paddingBottom: 4, borderRadius: 7, backgroundColor: '#0f2a1a', borderWidth: 1, borderColor: '#1f6f3a', pointerEvents: 'none' }}>
            <text style={{ color: C.green, fontSize: 12.5, fontWeight: 600 }}>{t.text}</text>
          </div>
        ))}
      </div>
      <Footer narrow={narrow} linkCount={linkCount} />
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, borderRadius: 6, borderWidth: 1, borderColor: color }}>
      <text style={{ color, fontSize: 12, fontWeight: 600 }}>{label}</text>
    </div>
  )
}

function Header({ page, loading, sim, modes, narrow, fps }: { page: Page; loading: boolean; sim: Sim; modes: { follow: boolean; still: boolean; chaos: boolean }; narrow: boolean; fps: number }) {
  const n = sim.spiders.length
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: HEADER, flexShrink: 0, paddingLeft: 16, paddingRight: 16, gap: 12, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.bg }}>
      <text style={{ color: C.fg, fontSize: 15, fontWeight: 700 }}>crawler</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexShrink: 1, minWidth: 0, height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 15, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, gap: 8 }}>
        <text style={{ color: loading ? C.amber : C.green, fontSize: 12 }}>{loading ? '●' : '●'}</text>
        <text style={{ color: C.muted, fontSize: 13, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{page.url}</text>
      </div>
      {modes.follow && <Chip label="curious" color={C.cyan} />}
      {modes.still && <Chip label="still" color={C.amber} />}
      {modes.chaos && <Chip label="chaos" color={C.red} />}
      <text style={{ color: C.muted, fontSize: 13, whiteSpace: 'nowrap' }}>
        {narrow ? `${n} · ${sim.indexed.size} idx` : `${n} spider${n === 1 ? '' : 's'}  ·  ${sim.indexed.size} indexed  ·  ${sim.stats.eaten} fed`}
      </text>
      {!narrow && <text style={{ color: C.dim, fontSize: 12, whiteSpace: 'nowrap' }}>{fps ? `${Math.round(fps)} fps` : ''}</text>}
    </div>
  )
}

function Footer({ narrow, linkCount }: { narrow: boolean; linkCount: number }) {
  const keys: [string, string][] = narrow
    ? [['click', 'feed'], ['f', 'flies'], ['s', 'spawn'], ['c', 'curious']]
    : [['click', 'feed / poke'], ['f', 'flies'], ['s', 'spawn'], ['w', 'web'], ['c', 'curious'], ['x', 'chaos'], ['r', 'still'], ['b', 'back'], ['ctrl-c', 'quit']]
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: FOOTER, flexShrink: 0, paddingLeft: 16, paddingRight: 16, gap: 14, borderTopWidth: 1, borderColor: C.border }}>
      {keys.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 5, alignItems: 'center' }}>
          <text style={{ color: C.fg, fontSize: 12, fontWeight: 600 }}>{k}</text>
          <text style={{ color: C.dim, fontSize: 12 }}>{v}</text>
        </div>
      ))}
      <div style={{ display: 'flex', flexGrow: 1 }} />
      {!narrow && <text style={{ color: C.dim, fontSize: 12 }}>{`${linkCount} links mapped`}</text>}
    </div>
  )
}

const SIZES: Record<string, { size: number; color: string; weight: number; gapTop: number }> = {
  h1: { size: 26, color: C.fg, weight: 700, gapTop: 6 },
  h2: { size: 20, color: C.fg, weight: 650, gapTop: 18 },
  h3: { size: 17, color: C.fg, weight: 600, gapTop: 12 },
  p: { size: 15, color: C.text, weight: 400, gapTop: 10 },
  li: { size: 15, color: C.text, weight: 400, gapTop: 6 },
  quote: { size: 15, color: C.muted, weight: 400, gapTop: 10 },
}

function Words({ bi, segs, size, color, weight, wordRefs, indexed, linkColor = C.blue }: {
  bi: number; segs: { text: string; href?: string }[]; size: number; color: string; weight: number
  wordRefs: Map<string, { id: number }>; indexed: Set<string>; linkColor?: string
}) {
  const ws = useMemo(() => {
    let run = 0
    let prev: string | undefined
    return words(segs).map((w, i) => {
      if (w.href && w.href !== prev) run++
      prev = w.href
      return { ...w, key: w.href ? `${bi}|${i}|${run}|${w.href}` : `${bi}|${i}` }
    })
  }, [segs, bi])
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', columnGap: size * 0.27, rowGap: size * 0.32 }}>
      {ws.map((w) => {
        const run = w.key.split('|')[2]
        const done = w.href ? indexed.has(`${bi}|${run}`) : false
        return (
          <text
            key={w.key}
            ref={(el: { id: number } | null) => { if (el) wordRefs.set(w.key, el); else wordRefs.delete(w.key) }}
            style={{ color: w.href ? (done ? C.green : linkColor) : color, fontSize: size, fontWeight: weight, textDecoration: w.href && done ? 'underline' : 'none' }}
          >
            {w.w}
          </text>
        )
      })}
    </div>
  )
}

const PageView = memo(function PageView({ page, indexed, wordRefs, narrow }: { page: Page; indexed: Set<string>; wordRefs: Map<string, { id: number }>; narrow: boolean; nIndexed: number }) {
  const serp = page.blocks.some((b) => b.kind === 'result')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 760, gap: serp ? 24 : 0 }}>
      {serp ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingLeft: 16, paddingRight: 16, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, maxWidth: 600 }}>
            <text style={{ color: C.dim, fontSize: 15 }}>⌕</text>
            <text style={{ color: C.fg, fontSize: 15 }}>{page.title}</text>
          </div>
          {page.note && <text style={{ color: C.dim, fontSize: 12.5 }}>{page.note}</text>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          <text style={{ color: C.dim, fontSize: 12.5 }}>{page.note ? `${page.url} · ${page.note}` : page.url}</text>
        </div>
      )}
      {page.blocks.map((b, bi) => <BlockView key={bi} b={b} bi={bi} indexed={indexed} wordRefs={wordRefs} narrow={narrow} />)}
    </div>
  )
})

function BlockView({ b, bi, indexed, wordRefs, narrow }: { b: Block; bi: number; indexed: Set<string>; wordRefs: Map<string, { id: number }>; narrow: boolean }) {
  if (b.kind === 'result') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <text style={{ color: C.muted, fontSize: 12.5 }}>{b.display}</text>
        <Words bi={bi} segs={[{ text: b.title, href: b.href }]} size={narrow ? 17 : 19} color={C.blue} weight={500} wordRefs={wordRefs} indexed={indexed} />
        <Words bi={bi + 1000} segs={b.snippet} size={14.5} color={C.text} weight={400} wordRefs={wordRefs} indexed={indexed} />
      </div>
    )
  }
  const s = SIZES[b.kind]!
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 10, marginTop: s.gapTop, paddingLeft: b.kind === 'quote' ? 14 : 0, borderLeftWidth: b.kind === 'quote' ? 2 : 0, borderColor: C.border }}>
      {b.kind === 'li' && <text style={{ color: C.dim, fontSize: s.size }}>•</text>}
      <div style={{ display: 'flex', flexShrink: 1, minWidth: 0 }}>
        <Words bi={bi} segs={b.segs} size={s.size} color={s.color} weight={s.weight} wordRefs={wordRefs} indexed={indexed} />
      </div>
    </div>
  )
}
