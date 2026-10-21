import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { COLUMN_IDS, KEY_PREFIX, seedBoard, type Board, type Card, type ColumnId } from './data'

export function defaultDataPath() {
  return (
    process.env.GLASS_KANBAN_DATA ??
    join(homedir(), 'Library', 'Application Support', 'Glass Kanban', 'board.json')
  )
}

export function loadBoard(path: string): Board {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Board
    if (parsed.version === 1 && parsed.columnOrder?.length === COLUMN_IDS.length) return parsed
  } catch {}
  return seedBoard()
}

export function saveBoard(path: string, board: Board) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(board, null, 2))
  renameSync(tmp, path)
}

export function columnOf(board: Board, cardId: string): ColumnId | null {
  for (const col of board.columnOrder) if (board.lanes[col].includes(cardId)) return col
  return null
}

export function moveCard(board: Board, cardId: string, to: ColumnId, index: number): Board {
  const from = columnOf(board, cardId)
  if (!from) return board
  const lanes = { ...board.lanes }
  const fromIndex = lanes[from].indexOf(cardId)
  lanes[from] = lanes[from].filter((id) => id !== cardId)
  const target = [...lanes[to]]
  const clamped = Math.max(0, Math.min(index, target.length))
  if (from === to && clamped === fromIndex) return board
  target.splice(clamped, 0, cardId)
  lanes[to] = target
  return { ...board, lanes }
}

export function moveColumn(board: Board, col: ColumnId, index: number): Board {
  const order = board.columnOrder.filter((c) => c !== col)
  const clamped = Math.max(0, Math.min(index, order.length))
  order.splice(clamped, 0, col)
  if (order.every((c, i) => c === board.columnOrder[i])) return board
  return { ...board, columnOrder: order }
}

export function updateCard(board: Board, cardId: string, patch: Partial<Card>): Board {
  const card = board.cards[cardId]
  if (!card) return board
  return { ...board, cards: { ...board.cards, [cardId]: { ...card, ...patch } } }
}

export function addCard(board: Board, col: ColumnId, title: string): { board: Board; id: string } {
  const id = `${KEY_PREFIX}-${board.nextNumber}`
  const card: Card = {
    id,
    title,
    description: '',
    labels: [],
    assignee: null,
    priority: 'none',
    estimate: 1,
    comments: [],
  }
  return {
    id,
    board: {
      ...board,
      nextNumber: board.nextNumber + 1,
      cards: { ...board.cards, [id]: card },
      lanes: { ...board.lanes, [col]: [id, ...board.lanes[col]] },
    },
  }
}

export function addComment(board: Board, cardId: string, author: string, body: string): Board {
  const card = board.cards[cardId]
  if (!card) return board
  const comment = { id: `${cardId}-c${Date.now()}`, author, body, at: 'just now' }
  return updateCard(board, cardId, { comments: [...card.comments, comment] })
}

export function deleteCard(board: Board, cardId: string): Board {
  const col = columnOf(board, cardId)
  if (!col) return board
  const cards = { ...board.cards }
  delete cards[cardId]
  return { ...board, cards, lanes: { ...board.lanes, [col]: board.lanes[col].filter((id) => id !== cardId) } }
}

export interface History {
  past: Board[]
  present: Board
  future: Board[]
}

export function commit(history: History, next: Board): History {
  if (next === history.present) return history
  return { past: [...history.past, history.present].slice(-200), present: next, future: [] }
}

export function undo(history: History): History {
  const prev = history.past[history.past.length - 1]
  if (!prev) return history
  return { past: history.past.slice(0, -1), present: prev, future: [history.present, ...history.future] }
}

export function redo(history: History): History {
  const next = history.future[0]
  if (!next) return history
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
}
