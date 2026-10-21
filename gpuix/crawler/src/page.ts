export type Seg = { text: string; href?: string }
export type Block =
  | { kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote'; segs: Seg[] }
  | { kind: 'result'; title: string; href: string; display: string; snippet: Seg[] }
export type Page = { url: string; title: string; blocks: Block[]; note?: string }

const R = (title: string, href: string, snippet: string): Block => {
  let display = href
  try {
    const u = new URL(href)
    display = `${u.hostname.replace(/^www\./, '')} › ${u.pathname.split('/').filter(Boolean).slice(0, 3).join(' › ')}`
  } catch {}
  return { kind: 'result', title, href, display: display.replace(/ › $/, ''), snippet: [{ text: snippet }] }
}

/** The default "page": a mock search-engine results page so the crawling/indexing joke lands. */
export function mockSerp(query = 'how do spiders walk'): Page {
  return {
    url: `crawl://search?q=${encodeURIComponent(query)}`,
    title: query,
    note: 'About 4,180,000 results (0.21 seconds)',
    blocks: [
      R('Spider locomotion - Wikipedia', 'https://en.wikipedia.org/wiki/Spider_locomotion',
        'Spiders walk with an alternating tetrapod gait: legs one and three on one side move together with legs two and four on the other, so four feet are always planted.'),
      R('Inverse kinematics for procedural animation', 'https://github.com/topics/inverse-kinematics',
        'Analytic two-bone IK places a knee from two segment lengths and a bend hint. Feet stay planted until they drift too far from their rest pose, then step.'),
      R('Hydraulic legs: how spiders extend their limbs', 'https://www.nature.com/articles/spider-hydraulics',
        'Spiders have flexor muscles but no extensors at two leg joints. They extend those joints with haemolymph pressure, which is why dead spiders curl up.'),
      R('requestAnimationFrame and fixed timesteps', 'https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame',
        'Run physics at a fixed step and render at the display rate. Accumulate frame time and consume it in constant slices so behaviour is identical at any fps.'),
      R('Show HN: A spider that crawls your terminal', 'https://news.ycombinator.com/item?id=41000000',
        'It indexes every link it walks over, plays dead when you click it, and builds webs in the corners when it gets bored. Feed it from another pane.'),
      R('Critically damped springs for smooth rotation', 'https://www.ryanjuckett.com/damped-springs/',
        'A critically damped spring reaches its target as fast as possible without overshoot, which makes it ideal for turning a body toward a moving heading.'),
      R('The Kitty graphics protocol', 'https://sw.kovidgoyal.net/kitty/graphics-protocol/',
        'Terminals that speak the protocol can display raster images in cells. GPUIX uses it to paint whole native GUIs inside kitty and Ghostty.'),
      R('Silk: stronger than steel by weight', 'https://www.britannica.com/science/spider-silk',
        'Dragline silk has a tensile strength comparable to high-grade alloy steel at a fraction of the density, which is how a spider can drop on a single thread.'),
      R('GPUI: Zed’s GPU-accelerated UI framework', 'https://www.gpui.rs/',
        'GPUI renders every frame on the GPU. Elements are laid out with flexbox and painted with Metal on macOS.'),
      R('Why spiders have eight eyes', 'https://www.sciencedaily.com/releases/spider-eyes.htm',
        'Jumping spiders use two large principal eyes for detail and six secondary eyes for motion, which is why they notice a moving cursor so quickly.'),
      R('Orb webs are built in two seconds… almost', 'https://www.smithsonianmag.com/science-nature/orb-webs',
        'An orb weaver lays radial spokes first, then a temporary scaffold spiral, then the sticky capture spiral from the outside in.'),
      R('Web crawler - Wikipedia', 'https://en.wikipedia.org/wiki/Web_crawler',
        'A web crawler, sometimes called a spider, is an Internet bot that systematically browses the World Wide Web for the purpose of indexing.'),
    ],
  }
}

const BLOCK_TAGS: Record<string, Block['kind']> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h3', p: 'p', li: 'li', blockquote: 'quote', dt: 'p', dd: 'p', figcaption: 'p', pre: 'p',
}

const clean = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))

/** Turn HTML into a flat list of text blocks with inline links (Bun's HTMLRewriter, streaming). */
export function parseHtml(html: string, baseUrl: string, maxBlocks = 80): Page {
  let title = ''
  const blocks: Block[] = []
  let cur: { kind: Block['kind']; segs: Seg[] } | null = null
  let href: string | undefined
  let skip = 0
  let inTitle = false
  const push = (text: string) => {
    if (!cur || skip) return
    const t = clean(text)
    if (!t) return
    const last = cur.segs[cur.segs.length - 1]
    if (last && last.href === href) last.text += t
    else cur.segs.push(href ? { text: t, href } : { text: t })
  }
  const close = () => {
    if (!cur) return
    const segs = cur.segs
      .map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ') }))
      .filter((s) => s.text.trim())
    if (segs.length) {
      segs[0]!.text = segs[0]!.text.trimStart()
      segs[segs.length - 1]!.text = segs[segs.length - 1]!.text.trimEnd()
      const words = segs.reduce((n, s) => n + s.text.split(' ').length, 0)
      if (blocks.length < maxBlocks && (words > 1 || cur.kind !== 'p')) blocks.push({ kind: cur.kind as 'p', segs })
    }
    cur = null
  }
  const rw = new HTMLRewriter()
    .on('script, style, noscript, svg, nav, footer, form, button, select, template', {
      element(e) {
        skip++
        e.onEndTag(() => { skip-- })
      },
    })
    .on('title', {
      element(e) {
        inTitle = true
        e.onEndTag(() => { inTitle = false })
      },
    })
    .on(Object.keys(BLOCK_TAGS).join(', '), {
      element(e) {
        if (skip) return
        close()
        cur = { kind: BLOCK_TAGS[e.tagName.toLowerCase()]!, segs: [] }
        e.onEndTag(() => close())
      },
    })
    .on('a[href]', {
      element(e) {
        const raw = e.getAttribute('href') ?? ''
        let abs: string | undefined
        try {
          const u = new URL(raw, baseUrl)
          if (u.protocol === 'http:' || u.protocol === 'https:') abs = u.href
        } catch {}
        href = abs
        e.onEndTag(() => { href = undefined })
      },
    })
    .onDocument({
      text(t) {
        if (inTitle) title += t.text
        else push(t.text)
      },
    })
  rw.transform(html)
  close()
  title = clean(title).replace(/\s+/g, ' ').trim()
  return { url: baseUrl, title: title || baseUrl, blocks }
}

export async function fetchPage(url: string, timeoutMs = 8000): Promise<Page> {
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`
  try {
    const res = await fetch(u, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'crawler/0.1 (GPUIX terminal demo; +https://github.com/remorses/gpuix)', accept: 'text/html' },
      redirect: 'follow',
    })
    const html = await res.text()
    const page = parseHtml(html.slice(0, 2_000_000), res.url || u)
    if (!page.blocks.length) page.blocks.push({ kind: 'p', segs: [{ text: 'This page has no readable text for the spider to walk on.' }] })
    if (!res.ok) page.note = `HTTP ${res.status}`
    return page
  } catch (err) {
    return {
      url: u,
      title: 'Could not crawl this page',
      note: String((err as Error)?.message ?? err),
      blocks: [{ kind: 'p', segs: [{ text: `The spider tried ${u} but the request failed. Press b to go back to the results page.` }] }],
    }
  }
}

/** Split segments into words, keeping each word's link. */
export function words(segs: Seg[]) {
  const out: { w: string; href?: string }[] = []
  for (const s of segs) for (const w of s.text.split(/\s+/)) if (w) out.push(s.href ? { w, href: s.href } : { w })
  return out
}
