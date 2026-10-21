import { AnimatePresence, motion, useGpuixRequired, useWindowSize, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CardFace, Icon, Kbd, LabelChip, Avatar } from './components'
import { COLUMN_META, LABEL_NAMES, PEOPLE, personName, type Board, type Card, type ColumnId } from './data'
import { textFocus } from './focus'
import { Palette, type PaletteAction } from './palette'
import { QuickAdd } from './quick-add'
import { DetailSheet } from './sheet'
import {
  addCard,
  addComment,
  columnOf,
  commit,
  deleteCard,
  loadBoard,
  moveCard,
  moveColumn,
  redo,
  saveBoard,
  undo,
  updateCard,
  type History,
} from './store'
import { seedBoard } from './data'
import { LIFT_SHADOW, T } from './theme'

export const COL_W = 288
export const COL_GAP = 12
export const BOARD_PAD = 20
const SHEET_W = 440
const DRAG_THRESHOLD = 4
const EDGE = 90

export interface Filters {
  query: string
  labels: string[]
  assignee: string | null
}

type CardDrag = {
  kind: 'card'
  id: string
  from: ColumnId
  ox: number
  oy: number
  x: number
  y: number
  gx: number
  gy: number
  w: number
  h: number
  moved: boolean
  settling: { x: number; y: number } | null
  target: { col: ColumnId; before: string | null }
  mids: Partial<Record<ColumnId, { id: string; mid: number }[]>>
}

type ColumnDrag = {
  kind: 'column'
  id: ColumnId
  ox: number
  oy: number
  x: number
  y: number
  gx: number
  gy: number
  w: number
  h: number
  moved: boolean
  settling: { x: number; y: number } | null
  index: number
}

type Drag = CardDrag | ColumnDrag

// The window-level key handler is installed by render(); it forwards here.
export const keyBus: { handler: ((e: KeyEvent) => void) | null } = { handler: null }

function matches(card: Card, f: Filters) {
  if (f.labels.length && !f.labels.some((l) => card.labels.includes(l))) return false
  if (f.assignee && card.assignee !== f.assignee) return false
  if (f.query) {
    const q = f.query.toLowerCase()
    if (!card.title.toLowerCase().includes(q) && !card.id.toLowerCase().includes(q)) return false
  }
  return true
}

export function App({ dataPath }: { dataPath: string }) {
  const renderer = useGpuixRequired()
  const win = useWindowSize()
  const [history, setHistory] = useState<History>(() => ({ past: [], present: loadBoard(dataPath), future: [] }))
  const board = history.present
  const boardRef = useRef(board)
  boardRef.current = board
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ query: '', labels: [], assignee: null })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [scrollX, setScrollX] = useState(0)
  const scrollRef = useRef(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [savedAt, setSavedAt] = useState<string>('')
  const cardRefs = useRef(new Map<string, PublicInstance>())
  const spacerRefs = useRef(new Map<string, PublicInstance>())
  const colSpacerRefs = useRef(new Map<ColumnId, PublicInstance>())
  const colRefs = useRef(new Map<ColumnId, PublicInstance>())

  const viewportW = win.width || 1440
  const contentW = BOARD_PAD * 2 + board.columnOrder.length * COL_W + (board.columnOrder.length - 1) * COL_GAP
  const maxScroll = Math.max(0, contentW - viewportW)

  const setScroll = useCallback(
    (v: number) => {
      const next = Math.max(0, Math.min(maxScroll, v))
      scrollRef.current = next
      setScrollX(next)
    },
    [maxScroll],
  )

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text })
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 2400)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    saveBoard(dataPath, board)
    setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }))
  }, [board, dataPath])

  const apply = useCallback((fn: (b: Board) => Board, message?: string) => {
    setHistory((h) => {
      const next = fn(h.present)
      return commit(h, next)
    })
    if (message) showToast(message)
  }, [showToast])

  const doUndo = useCallback(() => {
    setHistory((h) => undo(h))
    showToast('Undo')
  }, [showToast])
  const doRedo = useCallback(() => {
    setHistory((h) => redo(h))
    showToast('Redo')
  }, [showToast])

  // Close the sheet if its card disappears (undo of a create, delete).
  useEffect(() => {
    if (selectedId && !board.cards[selectedId]) setSelectedId(null)
  }, [board, selectedId])

  const visibleLanes = useMemo(() => {
    const out = {} as Record<ColumnId, Card[]>
    for (const col of board.columnOrder) {
      out[col] = board.lanes[col].map((id) => board.cards[id]!).filter((c) => c && matches(c, filters))
    }
    return out
  }, [board, filters])

  const filtering = filters.labels.length > 0 || !!filters.assignee || !!filters.query
  const visibleCount = Object.values(visibleLanes).reduce((n, l) => n + l.length, 0)
  const totalCount = Object.keys(board.cards).length

  // ---------- drag geometry ----------
  const slotAt = useCallback((x: number) => {
    const n = boardRef.current.columnOrder.length
    const i = Math.floor((x + scrollRef.current - BOARD_PAD + COL_GAP / 2) / (COL_W + COL_GAP))
    return Math.max(0, Math.min(n - 1, i))
  }, [])

  const cardTarget = useCallback(
    (d: CardDrag): CardDrag['target'] => {
      const col = boardRef.current.columnOrder[slotAt(d.x)]!
      const list = d.mids[col] ?? []
      const centerY = d.y - d.gy + d.h / 2
      let before: string | null = null
      for (const item of list) {
        if (item.mid > centerY) {
          before = item.id
          break
        }
      }
      if (col === d.from) {
        const lane = boardRef.current.lanes[col]
        const visible = list.map((m) => m.id)
        const srcIdx = lane.indexOf(d.id)
        const nextVisible = lane.slice(srcIdx + 1).find((id) => visible.includes(id)) ?? null
        if (before === nextVisible) before = d.id
      }
      return { col, before }
    },
    [slotAt],
  )

  const measureMids = useCallback(
    (id: string, h: number) => {
      const b = boardRef.current
      const mids: CardDrag['mids'] = {}
      for (const col of b.columnOrder) {
        const items: { id: string; mid: number }[] = []
        let passed = false
        for (const card of visibleLanes[col]) {
          if (card.id === id) {
            passed = true
            continue
          }
          const inst = cardRefs.current.get(card.id)
          const box = inst ? renderer.getElementBounds?.(inst.id) : null
          if (!box) continue
          items.push({ id: card.id, mid: box.y + box.height / 2 - (passed ? h : 0) })
        }
        mids[col] = items
      }
      return mids
    },
    [renderer, visibleLanes],
  )

  const publish = useCallback((d: Drag | null) => {
    dragRef.current = d
    setDrag(d ? { ...d } : null)
  }, [])

  const beginCard = useCallback(
    (card: Card, e: EventPayload) => {
      if (dragRef.current?.settling) return
      const inst = cardRefs.current.get(card.id)
      const box = inst ? renderer.getElementBounds?.(inst.id) : null
      if (!box) return
      const x = e.x ?? 0
      const y = e.y ?? 0
      const from = columnOf(boardRef.current, card.id)!
      dragRef.current = {
        kind: 'card',
        id: card.id,
        from,
        ox: x,
        oy: y,
        x,
        y,
        gx: x - box.x,
        gy: y - box.y,
        w: box.width,
        h: box.height,
        moved: false,
        settling: null,
        target: { col: from, before: card.id },
        mids: {},
      }
    },
    [renderer],
  )

  const beginColumn = useCallback(
    (col: ColumnId, e: EventPayload) => {
      if (dragRef.current?.settling) return
      const inst = colRefs.current.get(col)
      const box = inst ? renderer.getElementBounds?.(inst.id) : null
      if (!box) return
      const x = e.x ?? 0
      const y = e.y ?? 0
      dragRef.current = {
        kind: 'column',
        id: col,
        ox: x,
        oy: y,
        x,
        y,
        gx: x - box.x,
        gy: y - box.y,
        w: box.width,
        h: box.height,
        moved: false,
        settling: null,
        index: boardRef.current.columnOrder.indexOf(col),
      }
    },
    [renderer],
  )

  const retarget = useCallback(() => {
    const d = dragRef.current
    if (!d || !d.moved || d.settling) return
    if (d.kind === 'card') {
      const t = cardTarget(d)
      if (t.col !== d.target.col || t.before !== d.target.before) {
        d.target = t
        publish(d)
        return
      }
    } else {
      const index = slotAt(d.x)
      if (index !== d.index) {
        d.index = index
        publish(d)
        return
      }
    }
    overlayBus.current?.(d.x - d.gx, d.y - d.gy)
  }, [cardTarget, publish, slotAt])

  const move = useCallback(
    (e: EventPayload) => {
      const d = dragRef.current
      if (!d || d.settling) return
      d.x = e.x ?? d.x
      d.y = e.y ?? d.y
      if (!d.moved) {
        if (Math.hypot(d.x - d.ox, d.y - d.oy) < DRAG_THRESHOLD) return
        d.moved = true
        if (d.kind === 'card') {
          d.mids = measureMids(d.id, d.h)
          d.target = cardTarget(d)
        } else {
          d.index = slotAt(d.x)
        }
        publish(d)
        return
      }
      retarget()
    },
    [cardTarget, measureMids, publish, retarget, slotAt],
  )

  const finishDrop = useCallback(() => {
    const d = dragRef.current
    if (!d || !d.moved) return
    if (d.kind === 'card') {
      const { col, before } = d.target
      if (before !== d.id) {
        const lane = boardRef.current.lanes[col].filter((id) => id !== d.id)
        const index = before ? lane.indexOf(before) : lane.length
        const title = COLUMN_META[col].title
        apply((b) => moveCard(b, d.id, col, index), col === d.from ? `Reordered ${d.id}` : `Moved ${d.id} to ${title}`)
      }
    } else {
      const from = boardRef.current.columnOrder.indexOf(d.id)
      if (from !== d.index) apply((b) => moveColumn(b, d.id, d.index), `Moved ${COLUMN_META[d.id].title} column`)
    }
    publish(null)
  }, [apply, publish])

  const end = useCallback(
    (e: EventPayload) => {
      const d = dragRef.current
      if (!d || d.settling) return
      if (!d.moved) {
        dragRef.current = null
        if (d.kind === 'card') setSelectedId(d.id)
        return
      }
      d.x = e.x ?? d.x
      d.y = e.y ?? d.y
      const spacer =
        d.kind === 'card'
          ? spacerRefs.current.get(d.target.before ?? `end:${d.target.col}`)
          : colSpacerRefs.current.get(boardRef.current.columnOrder.filter((c) => c !== d.id)[d.index] ?? ('end' as ColumnId))
      const box = spacer ? renderer.getElementBounds?.(spacer.id) : null
      if (!box) {
        finishDrop()
        return
      }
      d.settling = { x: box.x, y: box.y }
      publish(d)
      // Fallback in case the settle animation's completion callback never fires.
      setTimeout(() => {
        if (dragRef.current === d) finishDrop()
      }, 400)
    },
    [finishDrop, publish, renderer],
  )

  // Auto-scroll horizontally while a drag hovers near either edge.
  const dragging = !!drag?.moved && !drag.settling
  useEffect(() => {
    if (!dragging) return
    const t = setInterval(() => {
      const d = dragRef.current
      if (!d || !d.moved || d.settling) return
      let v = 0
      if (d.x > viewportW - EDGE) v = ((d.x - (viewportW - EDGE)) / EDGE) * 22
      else if (d.x < EDGE) v = -((EDGE - d.x) / EDGE) * 22
      if (!v) return
      const next = Math.max(0, Math.min(maxScroll, scrollRef.current + v))
      if (next === scrollRef.current) return
      scrollRef.current = next
      setScrollX(next)
      retarget()
    }, 16)
    return () => clearInterval(t)
  }, [dragging, maxScroll, retarget, viewportW])

  const overlayBus = useRef<((x: number, y: number) => void) | null>(null)

  // ---------- actions ----------
  const createCard = useCallback(
    (col: ColumnId, title: string) => {
      let created = ''
      apply((b) => {
        const r = addCard(b, col, title)
        created = r.id
        return r.board
      })
      setTimeout(() => showToast(`Created ${created} in ${COLUMN_META[col].title}`), 0)
    },
    [apply, showToast],
  )

  const target = selectedId ?? hoveredId
  const runAction = useCallback(
    (a: PaletteAction) => {
      setPaletteOpen(false)
      switch (a.type) {
        case 'move':
          if (a.card) apply((b) => moveCard(b, a.card!, a.col, 0), `Moved ${a.card} to ${COLUMN_META[a.col].title}`)
          break
        case 'assign':
          if (a.card) apply((b) => updateCard(b, a.card!, { assignee: a.person }), `Assigned ${a.card} to ${personName(a.person)}`)
          break
        case 'priority':
          if (a.card) apply((b) => updateCard(b, a.card!, { priority: a.priority }), `Priority updated`)
          break
        case 'delete':
          if (a.card) apply((b) => deleteCard(b, a.card!), `Deleted ${a.card}`)
          break
        case 'filter-label':
          setFilters((f) => ({ ...f, labels: [a.label] }))
          break
        case 'filter-assignee':
          setFilters((f) => ({ ...f, assignee: a.person }))
          break
        case 'clear':
          setFilters({ query: '', labels: [], assignee: null })
          break
        case 'new':
          setQuickAddOpen(true)
          break
        case 'undo':
          doUndo()
          break
        case 'redo':
          doRedo()
          break
        case 'reset':
          apply(() => seedBoard(), 'Board reset to demo data')
          break
      }
    },
    [apply, doRedo, doUndo],
  )

  const typing = useCallback(() => {
    if (!textFocus.active()) return false
    if (renderer.getFocusedElementId?.() == null) {
      textFocus.reset()
      return false
    }
    return true
  }, [renderer])

  const onKey = useCallback(
    (e: KeyEvent) => {
      const key = (e.key ?? '').toLowerCase()
      const m = e.modifiers
      if (m?.cmd && key === 'k') {
        setPaletteOpen((o) => !o)
        return
      }
      if (paletteOpen || quickAddOpen) return
      if (m?.cmd && key === 'z' && !typing()) {
        if (m.shift) doRedo()
        else doUndo()
        return
      }
      if (key === 'escape') {
        if (selectedId && !typing()) setSelectedId(null)
        return
      }
      if (key === 'c' && !m?.cmd && !m?.ctrl && !m?.alt && !typing()) {
        setQuickAddOpen(true)
      }
    },
    [doRedo, doUndo, paletteOpen, quickAddOpen, selectedId, typing],
  )
  keyBus.handler = onKey

  const selectedCard = selectedId ? board.cards[selectedId] : undefined
  const selectedCol = selectedId ? columnOf(board, selectedId) : null

  // ---------- render ----------
  const order = board.columnOrder
  const colDrag = drag?.kind === 'column' && drag.moved ? drag : null
  const cardDrag = drag?.kind === 'card' && drag.moved ? drag : null
  const colsWithoutDragged = colDrag ? order.filter((c) => c !== colDrag.id) : order
  const colGapBefore = colDrag ? (colsWithoutDragged[colDrag.index] ?? 'end') : null

  return (
    <div
      testId="root"
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.windowTint, position: 'relative', userSelect: 'none' }}
    >
      <TopBar
        filters={filters}
        setFilters={setFilters}
        visibleCount={visibleCount}
        totalCount={totalCount}
        filtering={filtering}
        onNew={() => setQuickAddOpen(true)}
        onPalette={() => setPaletteOpen(true)}
      />
      <div
        testId="board"
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
        onScroll={(e) => {
          const precise = e.precise ?? true
          const dx = (e.deltaX ?? 0) || ((e.modifiers?.shift ? e.deltaY : 0) ?? 0)
          if (!dx) return
          setScroll(scrollRef.current - dx * (precise ? 1 : 32))
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: -scrollX,
            top: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'row',
            paddingLeft: BOARD_PAD,
            paddingRight: BOARD_PAD,
            paddingTop: 4,
            paddingBottom: 18,
          }}
        >
          {order.map((col) => {
            const isDragged = colDrag?.id === col
            return (
              <div key={col} style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
                <motion.div
                  key={isDragged ? `cs-${col}-src` : `cs-${col}`}
                  ref={(r: PublicInstance | null) => {
                    if (r) colSpacerRefs.current.set(col, r)
                  }}
                  initial={isDragged ? { width: COL_W + COL_GAP } : false}
                  animate={{ width: colDrag && isGapHere(colDrag, colsWithoutDragged, order, col) ? COL_W + COL_GAP : 0 }}
                  transition={{ duration: colDrag ? 0.2 : 0, ease: 'easeOut' }}
                  style={{ height: '100%', flexShrink: 0 }}
                />
                <div
                  ref={(r: PublicInstance | null) => {
                    if (r) colRefs.current.set(col, r)
                  }}
                  style={
                    isDragged
                      ? { position: 'absolute', left: 0, top: 0, width: COL_W, height: 40, opacity: 0.01 }
                      : { display: 'flex', flexDirection: 'row', height: '100%', flexShrink: 0 }
                  }
                >
                  <Column
                    col={col}
                    cards={visibleLanes[col]}
                    allCount={board.lanes[col].length}
                    drag={cardDrag}
                    selectedId={selectedId}
                    cardRefs={cardRefs.current}
                    spacerRefs={spacerRefs.current}
                    onCardDown={beginCard}
                    onColumnDown={beginColumn}
                    onMove={move}
                    onUp={end}
                    onHover={setHoveredId}
                    onAdd={() => setQuickAddOpen(true)}
                  />
                  <div style={{ width: COL_GAP, flexShrink: 0 }} />
                </div>
              </div>
            )
          })}
          <motion.div
            ref={(r: PublicInstance | null) => {
              if (r) colSpacerRefs.current.set('end' as ColumnId, r)
            }}
            initial={false}
            animate={{ width: colDrag && colGapBefore === 'end' && nextOf(colsWithoutDragged, order, colDrag.id) !== 'end' ? COL_W + COL_GAP : 0 }}
            transition={{ duration: colDrag ? 0.2 : 0, ease: 'easeOut' }}
            style={{ height: '100%', flexShrink: 0 }}
          />
        </div>
        {maxScroll > 0 ? (
          <div style={{ position: 'absolute', left: 20, right: 20, bottom: 6, height: 4, pointerEvents: 'none' }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                height: 4,
                borderRadius: 2,
                backgroundColor: '#FFFFFF2A',
                left: ((viewportW - 40) * scrollX) / contentW,
                width: ((viewportW - 40) * viewportW) / contentW,
              }}
            />
          </div>
        ) : null}
      </div>
      <StatusBar savedAt={savedAt} dataPath={dataPath} canUndo={history.past.length > 0} canRedo={history.future.length > 0} />
      {drag?.moved ? (
        <DragOverlay
          key="overlay"
          drag={drag}
          card={drag.kind === 'card' ? board.cards[drag.id]! : undefined}
          column={drag.kind === 'column' ? { id: drag.id, cards: visibleLanes[drag.id], count: board.lanes[drag.id].length } : undefined}
          bus={overlayBus}
          onSettled={finishDrop}
        />
      ) : null}
      <AnimatePresence>
        {selectedCard && selectedCol ? (
          <motion.div
            key="sheet"
            initial={{ width: 0, opacity: 0.6 }}
            animate={{ width: SHEET_W, opacity: 1 }}
            exit={{ width: 0, opacity: 0.6 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              right: 0,
              top: 52,
              bottom: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'flex-end',
            }}
          >
            <DetailSheet
              key={selectedCard.id}
              width={SHEET_W}
              card={selectedCard}
              column={selectedCol}
              columns={order}
              onUpdate={(patch, msg) => apply((b) => updateCard(b, selectedCard.id, patch), msg)}
              onMove={(col) => apply((b) => moveCard(b, selectedCard.id, col, 0), `Moved ${selectedCard.id} to ${COLUMN_META[col].title}`)}
              onComment={(body) => apply((b) => addComment(b, selectedCard.id, 'sofia', body), 'Comment added')}
              onDelete={() => apply((b) => deleteCard(b, selectedCard.id), `Deleted ${selectedCard.id}`)}
              onClose={() => setSelectedId(null)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, bottom: 18 }}
            animate={{ opacity: 1, bottom: 44 }}
            exit={{ opacity: 0, bottom: 36 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingLeft: 14,
                paddingRight: 14,
                height: 36,
                borderRadius: 18,
                backgroundColor: '#2A2E36',
                borderWidth: 1,
                borderColor: '#FFFFFF1A',
                boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: '#00000080' },
              }}
            >
              <text testId="toast" style={{ color: T.text, fontSize: 13 }}>{toast.text}</text>
              {toast.text !== 'Undo' && toast.text !== 'Redo' ? <Kbd>⌘Z</Kbd> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Palette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        target={target && board.cards[target] ? board.cards[target]! : null}
        targetColumn={target ? columnOf(board, target) : null}
        columns={order}
        onRun={runAction}
      />
      <QuickAdd open={quickAddOpen} onOpenChange={setQuickAddOpen} columns={order} onCreate={createCard} />
    </div>
  )
}

function nextOf(without: ColumnId[], order: ColumnId[], col: ColumnId): ColumnId | 'end' {
  const idx = order.indexOf(col)
  for (let i = idx + 1; i < order.length; i++) if (without.includes(order[i]!)) return order[i]!
  return 'end'
}

// The gap sits on the spacer in front of `colGapBefore`. While the target is the
// dragged column's own slot, the dragged column's spacer holds the gap instead,
// so the drag starts without any movement.
function isGapHere(d: ColumnDrag, without: ColumnId[], order: ColumnId[], col: ColumnId) {
  const before = without[d.index] ?? 'end'
  const ownSlot = before === nextOf(without, order, d.id)
  if (col === d.id) return ownSlot
  return !ownSlot && before === col
}

const Column = memo(function Column({
  col,
  cards,
  allCount,
  drag,
  selectedId,
  cardRefs,
  spacerRefs,
  onCardDown,
  onColumnDown,
  onMove,
  onUp,
  onHover,
  onAdd,
}: {
  col: ColumnId
  cards: Card[]
  allCount: number
  drag: CardDrag | null
  selectedId: string | null
  cardRefs: Map<string, PublicInstance>
  spacerRefs: Map<string, PublicInstance>
  onCardDown: (card: Card, e: EventPayload) => void
  onColumnDown: (col: ColumnId, e: EventPayload) => void
  onMove: (e: EventPayload) => void
  onUp: (e: EventPayload) => void
  onHover: (id: string | null) => void
  onAdd: () => void
}) {
  const meta = COLUMN_META[col]
  const points = cards.reduce((n, c) => n + c.estimate, 0)
  const gapBefore = drag && drag.target.col === col ? drag.target.before : undefined
  const transition = { duration: drag ? 0.18 : 0, ease: 'easeOut' as const }
  const highlight = drag && drag.target.col === col
  return (
    <div
      testId={`column-${col}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: COL_W,
        height: '100%',
        flexShrink: 0,
        borderRadius: 14,
        backgroundColor: highlight ? '#FFFFFF10' : T.lane,
        borderWidth: 1,
        borderColor: highlight ? '#FFFFFF1F' : T.laneBorder,
      }}
    >
      <div
        testId={`column-handle-${col}`}
        onMouseDown={(e) => onColumnDown(col, e)}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 44,
          paddingLeft: 14,
          paddingRight: 10,
          flexShrink: 0,
          cursor: 'grab',
          active: { cursor: 'grabbing' },
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: meta.tint }} />
        <text style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>{meta.title}</text>
        <text testId={`count-${col}`} style={{ color: T.text3, fontSize: 12 }}>
          {cards.length === allCount ? String(allCount) : `${cards.length} / ${allCount}`}
        </text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ color: T.text3, fontSize: 11 }}>{`${points} pts`}</text>
        <div
          testId={`add-${col}`}
          onClick={onAdd}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            hover: { backgroundColor: '#FFFFFF14' },
          }}
        >
          <Icon name="plus" size={13} color={T.text3} />
        </div>
      </div>
      <div
        testId={`lane-${col}`}
        style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflowY: 'scroll', paddingLeft: 8, paddingRight: 8, position: 'relative' }}
      >
        {cards.map((card) => {
          const isSource = drag?.id === card.id
          const gapOpen = drag ? gapBefore === card.id : false
          return (
            <div key={card.id} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <motion.div
                key={isSource ? `sp-${card.id}-src` : `sp-${card.id}`}
                ref={(r: PublicInstance | null) => {
                  if (r) spacerRefs.set(card.id, r)
                }}
                initial={isSource ? { height: drag!.h } : false}
                animate={{ height: gapOpen ? drag!.h : 0 }}
                transition={transition}
                style={{ flexShrink: 0, overflow: 'hidden', paddingLeft: 0 }}
              >
                {gapOpen ? <GapSlot h={drag!.h} /> : null}
              </motion.div>
              <div
                testId={`card-${card.id}`}
                ref={(r: PublicInstance | null) => {
                  if (r) cardRefs.set(card.id, r)
                }}
                style={
                  isSource
                    ? { position: 'absolute', left: 8, right: 8, top: 0, opacity: 0.01, display: 'flex', flexDirection: 'column' }
                    : { display: 'flex', flexDirection: 'column', paddingBottom: 8, flexShrink: 0, cursor: 'default' }
                }
              >
                <CardFace
                  card={card}
                  selected={selectedId === card.id}
                  handlers={{
                    onMouseDown: (e: EventPayload) => onCardDown(card, e),
                    onMouseMove: onMove,
                    onMouseUp: onUp,
                    onMouseEnter: () => onHover(card.id),
                    onMouseLeave: () => onHover(null),
                  }}
                />
              </div>
            </div>
          )
        })}
        <motion.div
          ref={(r: PublicInstance | null) => {
            if (r) spacerRefs.set(`end:${col}`, r)
          }}
          initial={false}
          animate={{ height: drag && gapBefore === null ? drag.h : 0 }}
          transition={transition}
          style={{ flexShrink: 0, overflow: 'hidden' }}
        >
          {drag && gapBefore === null ? <GapSlot h={drag.h} /> : null}
        </motion.div>
        {cards.length === 0 && !(drag && drag.target.col === col) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80 }}>
            <text style={{ color: T.text3, fontSize: 12 }}>No issues</text>
          </div>
        ) : null}
        <div style={{ height: 12, flexShrink: 0 }} />
      </div>
    </div>
  )
})

function GapSlot({ h }: { h: number }) {
  return (
    <div style={{ height: h, paddingBottom: 8, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flexGrow: 1,
          borderRadius: 10,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: '#4FA3F766',
          backgroundColor: '#4FA3F70F',
        }}
      />
    </div>
  )
}

function DragOverlay({
  drag,
  card,
  column,
  bus,
  onSettled,
}: {
  drag: Drag
  card?: Card
  column?: { id: ColumnId; cards: Card[]; count: number }
  bus: React.MutableRefObject<((x: number, y: number) => void) | null>
  onSettled: () => void
}) {
  const [pos, setPos] = useState({ x: drag.x - drag.gx, y: drag.y - drag.gy })
  useEffect(() => {
    bus.current = (x, y) => setPos({ x, y })
    return () => {
      bus.current = null
    }
  }, [bus])
  const settling = drag.settling
  const settledRef = useRef(false)
  useEffect(() => {
    if (!settling) return
    const t = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true
        onSettled()
      }
    }, 260)
    return () => clearTimeout(t)
  }, [settling, onSettled])
  const left = settling ? pos.x : drag.x - drag.gx
  const top = settling ? pos.y : drag.y - drag.gy
  return (
    <motion.div
      initial={false}
      animate={settling ? { left: settling.x, top: settling.y } : { left, top }}
      transition={{ duration: settling ? 0.16 : 0, ease: 'easeOut' }}
      onMotionComplete={() => {
        if (settling && !settledRef.current) {
          settledRef.current = true
          onSettled()
        }
      }}
      style={{ position: 'absolute', left, top, width: drag.w, pointerEvents: 'none' }}
    >
      {card ? (
        <div style={{ borderRadius: 10, boxShadow: settling ? undefined : LIFT_SHADOW, paddingBottom: 0 }}>
          <CardFace card={card} lifted />
        </div>
      ) : column ? (
        <div
          style={{
            width: COL_W,
            height: Math.min(drag.h, 420),
            borderRadius: 14,
            backgroundColor: '#1A1D23F2',
            borderWidth: 1,
            borderColor: '#FFFFFF1F',
            boxShadow: LIFT_SHADOW,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLUMN_META[column.id].tint }} />
            <text style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>{COLUMN_META[column.id].title}</text>
            <text style={{ color: T.text3, fontSize: 12 }}>{String(column.count)}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8, paddingRight: 8 }}>
            {column.cards.slice(0, 5).map((c) => (
              <CardFace key={c.id} card={c} />
            ))}
          </div>
        </div>
      ) : null}
    </motion.div>
  )
}

function TopBar({
  filters,
  setFilters,
  visibleCount,
  totalCount,
  filtering,
  onNew,
  onPalette,
}: {
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  visibleCount: number
  totalCount: number
  filtering: boolean
  onNew: () => void
  onPalette: () => void
}) {
  const toggleLabel = (l: string) =>
    setFilters((f) => ({ ...f, labels: f.labels.includes(l) ? f.labels.filter((x) => x !== l) : [...f.labels, l] }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 52, paddingLeft: 88, paddingRight: 16, gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: '#ECEEF2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <text style={{ color: '#111318', fontSize: 12, fontWeight: 700 }}>F</text>
          </div>
          <text style={{ color: T.text, fontSize: 14, fontWeight: 600 }}>Fintra</text>
          <text style={{ color: T.text3, fontSize: 14 }}>/</text>
          <text style={{ color: T.text2, fontSize: 14 }}>Q4 Roadmap</text>
        </div>
        <div style={{ flexGrow: 1 }} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            width: 260,
            height: 30,
            paddingLeft: 10,
            borderRadius: 8,
            backgroundColor: T.field,
            borderWidth: 1,
            borderColor: T.fieldBorder,
          }}
        >
          <Icon name="search" size={13} color={T.text3} />
          <input
            testId="search"
            value={filters.query}
            placeholder="Search issues"
            onFocus={textFocus.onFocus}
            onBlur={textFocus.onBlur}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.value ?? '' }))}
            style={{ flexGrow: 1, height: 28, color: T.text, fontSize: 13, backgroundColor: '#00000000' }}
          />
        </div>
        <div
          testId="open-palette"
          onClick={onPalette}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 30,
            paddingLeft: 10,
            paddingRight: 8,
            borderRadius: 8,
            cursor: 'pointer',
            borderWidth: 1,
            borderColor: T.fieldBorder,
            hover: { backgroundColor: '#FFFFFF0F' },
          }}
        >
          <text style={{ color: T.text2, fontSize: 13 }}>Commands</text>
          <Kbd>⌘K</Kbd>
        </div>
        <div
          testId="new-issue"
          onClick={onNew}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 30,
            paddingLeft: 10,
            paddingRight: 8,
            borderRadius: 8,
            cursor: 'pointer',
            backgroundColor: '#ECEEF2',
            hover: { backgroundColor: '#FFFFFF' },
          }}
        >
          <Icon name="plus" size={13} color="#111318" />
          <text style={{ color: '#111318', fontSize: 13, fontWeight: 600 }}>New issue</text>
          <div style={{ paddingLeft: 5, paddingRight: 5, height: 18, borderRadius: 5, backgroundColor: '#11131814', display: 'flex', alignItems: 'center' }}>
            <text style={{ color: '#111318AA', fontSize: 11 }}>C</text>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 44, paddingLeft: 20, paddingRight: 16, gap: 6 }}>
        <Icon name="filter" size={14} color={T.text3} />
        <text style={{ color: T.text3, fontSize: 12, paddingRight: 4 }}>Labels</text>
        {LABEL_NAMES.map((l) => {
          const on = filters.labels.includes(l)
          return (
            <div
              key={l}
              testId={`filter-${l}`}
              onClick={() => toggleLabel(l)}
              style={{
                borderRadius: 12,
                cursor: 'pointer',
                backgroundColor: on ? '#FFFFFF1F' : '#00000000',
                hover: { backgroundColor: on ? '#FFFFFF26' : '#FFFFFF0D' },
              }}
            >
              <LabelChip name={l} small />
            </div>
          )
        })}
        <div style={{ width: 1, height: 18, backgroundColor: T.hairline, marginLeft: 6, marginRight: 6 }} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {PEOPLE.map((p) => {
            const on = filters.assignee === p.id
            return (
              <div
                key={p.id}
                testId={`filter-person-${p.id}`}
                onClick={() => setFilters((f) => ({ ...f, assignee: on ? null : p.id }))}
                style={{
                  padding: 2,
                  borderRadius: 13,
                  cursor: 'pointer',
                  borderWidth: 1.5,
                  borderColor: on ? T.accent : '#00000000',
                  opacity: filters.assignee && !on ? 0.45 : 1,
                }}
              >
                <Avatar person={p.id} size={20} />
              </div>
            )
          })}
        </div>
        <div style={{ flexGrow: 1 }} />
        {filtering ? (
          <div
            testId="clear-filters"
            onClick={() => setFilters({ query: '', labels: [], assignee: null })}
            style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', cursor: 'pointer', hover: { backgroundColor: '#FFFFFF0F' } }}
          >
            <text style={{ color: T.accent, fontSize: 12 }}>Clear</text>
          </div>
        ) : null}
        <text testId="visible-count" style={{ color: T.text3, fontSize: 12 }}>
          {filtering ? `${visibleCount} of ${totalCount} issues` : `${totalCount} issues`}
        </text>
      </div>
    </div>
  )
}

function StatusBar({ savedAt, dataPath, canUndo, canRedo }: { savedAt: string; dataPath: string; canUndo: boolean; canRedo: boolean }) {
  const file = dataPath.split('/').slice(-2).join('/')
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 28, paddingLeft: 20, paddingRight: 16, gap: 8, flexShrink: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#3CC48D' }} />
      <text testId="saved" style={{ color: T.text3, fontSize: 11 }}>{`Saved to ${file} · ${savedAt}`}</text>
      <div style={{ flexGrow: 1 }} />
      <text style={{ color: canUndo ? T.text3 : '#FFFFFF33', fontSize: 11 }}>⌘Z undo</text>
      <text style={{ color: canRedo ? T.text3 : '#FFFFFF33', fontSize: 11 }}>⇧⌘Z redo</text>
      <text style={{ color: T.text3, fontSize: 11 }}>C new issue</text>
      <text style={{ color: T.text3, fontSize: 11 }}>⌘K commands</text>
    </div>
  )
}
