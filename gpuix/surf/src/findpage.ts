/**
 * In-page find: counts visible text only, highlights every match (CSS Custom Highlight API, so user-select:none text too)
 * and scrolls the current one into view, starting from the first match in the viewport.
 * window.find() could select matches in hidden nodes (Wikipedia's collapsed menus), leaving nothing on screen.
 */
const SCRIPT = `(q, back, fresh) => {
  const s = getSelection(), H = window.CSS && CSS.highlights
  const clear = () => { if (H) { H.delete('surf-find'); H.delete('surf-find-current') } }
  if (!q) { clear(); s.removeAllRanges(); window.__surfFind = null; return { count: 0, found: false, index: 0 } }
  if (H && !document.getElementById('__surf_find')) {
    const st = document.createElement('style'); st.id = '__surf_find'
    st.textContent = '::highlight(surf-find){background-color:#ffe36e;color:#000}::highlight(surf-find-current){background-color:#ff9632;color:#000}'
    document.documentElement.appendChild(st)
  }
  const l = q.toLowerCase()
  let st = window.__surfFind
  if (fresh || !st || st.q !== l || !st.m.length || !st.m[0][0].isConnected) {
    st = window.__surfFind = { q: l, m: [], i: -1 }
    const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode(n) {
      const e = n.parentElement
      if (!e || !n.nodeValue.toLowerCase().includes(l) || e.closest('script,style,noscript,template')) return 2
      if (e.checkVisibility ? !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !e.getClientRects().length) return 2
      return 1
    } })
    for (let n; (n = w.nextNode());) {
      const t = n.nodeValue.toLowerCase()
      for (let k = t.indexOf(l); k >= 0; k = t.indexOf(l, k + l.length)) {
        const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + l.length); st.m.push([n, k, r])
      }
    }
  }
  const n = st.m.length
  if (!n) { clear(); s.removeAllRanges(); return { count: 0, found: false, index: 0 } }
  const pinned = (e) => { for (; e && e !== document.body; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true } return false }
  if (st.i < 0) {
    let i = st.m.findIndex((m) => m[2].getBoundingClientRect().top >= 0 && !pinned(m[0].parentElement))
    if (i < 0) i = 0
    st.i = back ? (i - 1 + n) % n : i
  } else st.i = (st.i + (back ? -1 : 1) + n) % n
  const cur = st.m[st.i]
  if (H) { H.set('surf-find', new Highlight(...st.m.map((m) => m[2]))); H.set('surf-find-current', new Highlight(cur[2])) }
  s.removeAllRanges(); s.addRange(cur[2].cloneRange())
  const b = cur[2].getBoundingClientRect()
  if (b.top < 0 || b.bottom > innerHeight) cur[0].parentElement.scrollIntoView({ block: 'center' })
  return { count: n, found: true, index: st.i + 1 }
}`

export function findExpression(query: string, opts: { backwards?: boolean; fromStart?: boolean } = {}) {
  return `(${SCRIPT})(${JSON.stringify(query)}, ${!!opts.backwards}, ${!!opts.fromStart})`
}
