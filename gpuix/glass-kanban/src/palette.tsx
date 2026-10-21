import * as Combobox from '@gpuix/react/combobox'
import * as Dialog from '@gpuix/react/dialog'
import { useGpuixRequired } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Icon, Kbd } from './components'
import { COLUMN_META, LABEL_NAMES, PEOPLE, PRIORITIES, PRIORITY_NAMES, type Card, type ColumnId, type Priority } from './data'
import { textFocus } from './focus'
import { T } from './theme'

export type PaletteAction =
  | { type: 'move'; card: string | null; col: ColumnId }
  | { type: 'assign'; card: string | null; person: string | null }
  | { type: 'priority'; card: string | null; priority: Priority }
  | { type: 'delete'; card: string | null }
  | { type: 'filter-label'; label: string }
  | { type: 'filter-assignee'; person: string }
  | { type: 'clear' }
  | { type: 'new' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }

interface Entry {
  label: string
  group: string
  hint?: string
  action: PaletteAction
}

function buildEntries(target: Card | null, targetColumn: ColumnId | null, columns: ColumnId[]): Entry[] {
  const out: Entry[] = []
  const card = target?.id ?? null
  if (target) {
    for (const col of columns) {
      if (col !== targetColumn) out.push({ label: `Move to ${COLUMN_META[col].title}`, group: target.id, action: { type: 'move', card, col } })
    }
    for (const p of PEOPLE) {
      if (p.id !== target.assignee) out.push({ label: `Assign to ${p.name}`, group: target.id, hint: p.role, action: { type: 'assign', card, person: p.id } })
    }
    out.push({ label: 'Unassign', group: target.id, action: { type: 'assign', card, person: null } })
    for (const pr of PRIORITIES) {
      if (pr !== target.priority) out.push({ label: `Set priority: ${PRIORITY_NAMES[pr]}`, group: target.id, action: { type: 'priority', card, priority: pr } })
    }
    out.push({ label: 'Delete issue', group: target.id, action: { type: 'delete', card } })
  }
  for (const l of LABEL_NAMES) out.push({ label: `Filter by label: ${l}`, group: 'View', action: { type: 'filter-label', label: l } })
  for (const p of PEOPLE) out.push({ label: `Filter by assignee: ${p.name}`, group: 'View', action: { type: 'filter-assignee', person: p.id } })
  out.push({ label: 'Clear filters', group: 'View', action: { type: 'clear' } })
  out.push({ label: 'New issue', group: 'Board', hint: 'C', action: { type: 'new' } })
  out.push({ label: 'Undo', group: 'Board', hint: '⌘Z', action: { type: 'undo' } })
  out.push({ label: 'Redo', group: 'Board', hint: '⇧⌘Z', action: { type: 'redo' } })
  out.push({ label: 'Reset demo board', group: 'Board', action: { type: 'reset' } })
  return out
}

export function Palette({
  open,
  onOpenChange,
  target,
  targetColumn,
  columns,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: Card | null
  targetColumn: ColumnId | null
  columns: ColumnId[]
  onRun: (a: PaletteAction) => void
}) {
  const inputRef = useRef<any>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#0000004D' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 110, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <Dialog.Popup
            initialFocus={inputRef}
            testId="palette"
            style={{
              width: 600,
              borderRadius: 14,
              backgroundColor: T.popover,
              borderWidth: 1,
              borderColor: '#FFFFFF1F',
              boxShadow: { offsetX: 0, offsetY: 24, blurRadius: 60, spreadRadius: 0, color: '#000000A0' },
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {open ? <PaletteBody inputRef={inputRef} target={target} targetColumn={targetColumn} columns={columns} onRun={onRun} /> : null}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaletteBody({
  inputRef,
  target,
  targetColumn,
  columns,
  onRun,
}: {
  inputRef: RefObject<any>
  target: Card | null
  targetColumn: ColumnId | null
  columns: ColumnId[]
  onRun: (a: PaletteAction) => void
}) {
  useFocusOnMount(inputRef)
  const entries = useMemo(() => buildEntries(target, targetColumn, columns), [target, targetColumn, columns])
  const byLabel = useMemo(() => new Map(entries.map((e) => [e.label, e])), [entries])
  const [query, setQuery] = useState('')
  const filtered = entries.filter((e) => e.label.toLowerCase().includes(query.trim().toLowerCase()))
  const shown = filtered.slice(0, 9)
  return (
    <Combobox.Root
      items={entries.map((e) => e.label)}
      open
      inputValue={query}
      onInputValueChange={setQuery}
      autoHighlight="always"
      onValueChange={(v) => {
        const entry = typeof v === 'string' ? byLabel.get(v) : undefined
        if (entry) onRun(entry.action)
      }}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingLeft: 18, paddingRight: 16 }}>
        <Icon name="search" size={15} color={T.text3} />
        <Combobox.Input
          ref={inputRef}
          testId="palette-input"
          autoFocus
          placeholder={target ? `Type a command for ${target.id}…` : 'Type a command…'}
          onFocus={textFocus.onFocus}
          onBlur={textFocus.onBlur}
          style={{ flexGrow: 1, height: 30, color: T.text, fontSize: 15, backgroundColor: '#00000000' }}
        />
        <Kbd>esc</Kbd>
      </div>
      {target ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 18, paddingRight: 18, paddingBottom: 10 }}>
          <div style={{ paddingLeft: 7, paddingRight: 7, height: 20, borderRadius: 5, backgroundColor: '#FFFFFF10', display: 'flex', alignItems: 'center' }}>
            <text style={{ color: T.text2, fontSize: 11 }}>{target.id}</text>
          </div>
          <text style={{ color: T.text3, fontSize: 12, lineClamp: 1 }}>{target.title}</text>
        </div>
      ) : null}
      <div style={{ height: 1, backgroundColor: T.hairline }} />
      <Combobox.List style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', paddingTop: 6, paddingBottom: 6, paddingLeft: 6, paddingRight: 6 }}>
        {shown.map((e, i) => (
          <Combobox.Item
            key={e.label}
            value={e.label}
            testId={`cmd-${i}`}
            style={(state) => ({
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              alignSelf: 'stretch',
              width: '100%',
              height: 36,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 8,
              cursor: 'pointer',
              backgroundColor: state.highlighted ? '#FFFFFF1C' : '#00000000',
            })}
          >
            <text style={{ color: T.text, fontSize: 13, flexGrow: 1 }}>{e.label}</text>
            <text style={{ color: T.text3, fontSize: 11 }}>{e.hint ?? e.group}</text>
          </Combobox.Item>
        ))}
        {shown.length === 0 ? (
          <div style={{ height: 44, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
            <text style={{ color: T.text3, fontSize: 13 }}>No matching commands</text>
          </div>
        ) : null}
      </Combobox.List>
      <div style={{ height: 1, backgroundColor: T.hairline }} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 34, paddingLeft: 18 }}>
        <text style={{ color: T.text3, fontSize: 11 }}>↑↓ navigate</text>
        <text style={{ color: T.text3, fontSize: 11 }}>↵ run</text>
        <text style={{ color: T.text3, fontSize: 11 }}>{`${filtered.length} commands`}</text>
      </div>
    </Combobox.Root>
  )
}

export function useFocusOnMount(ref: RefObject<any>) {
  const renderer = useGpuixRequired()
  useEffect(() => {
    const t = setTimeout(() => {
      if (ref.current) renderer.focusElement?.(ref.current.id)
    }, 60)
    return () => clearTimeout(t)
  }, [ref, renderer])
}
