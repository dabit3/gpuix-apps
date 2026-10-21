import * as Dialog from '@gpuix/react/dialog'
import { useGpuixRequired } from '@gpuix/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Kbd } from './components'
import { COLUMN_META, type ColumnId } from './data'
import { textFocus } from './focus'
import { useFocusOnMount } from './palette'
import { T } from './theme'

export function QuickAdd({
  open,
  onOpenChange,
  columns,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: ColumnId[]
  onCreate: (col: ColumnId, title: string) => void
}) {
  const inputRef = useRef<any>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#0000004D' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <Dialog.Popup
            initialFocus={inputRef}
            testId="quick-add"
            style={{
              width: 560,
              borderRadius: 14,
              backgroundColor: T.popover,
              borderWidth: 1,
              borderColor: '#FFFFFF1F',
              boxShadow: { offsetX: 0, offsetY: 24, blurRadius: 60, spreadRadius: 0, color: '#000000A0' },
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {open ? <QuickAddBody inputRef={inputRef} columns={columns} onCreate={onCreate} onClose={() => onOpenChange(false)} /> : null}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function QuickAddBody({ inputRef, columns, onCreate, onClose }: { inputRef: RefObject<any>; columns: ColumnId[]; onCreate: (col: ColumnId, title: string) => void; onClose: () => void }) {
  useFocusOnMount(inputRef)
  const [title, setTitle] = useState('')
  const [col, setCol] = useState<ColumnId>('todo')
  const submit = () => {
    const t = title.trim()
    if (!t) return
    onCreate(col, t)
    onClose()
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 16, paddingBottom: 14, paddingLeft: 18, paddingRight: 18, gap: 14 }}>
      <text style={{ color: T.text3, fontSize: 12 }}>New issue</text>
      <input
        ref={inputRef}
        testId="quick-add-title"
        autoFocus
        value={title}
        placeholder="Issue title"
        onFocus={textFocus.onFocus}
        onBlur={textFocus.onBlur}
        onChange={(e) => setTitle(e.value ?? '')}
        onSubmit={submit}
        style={{ height: 30, color: T.text, fontSize: 17, fontWeight: 500, backgroundColor: '#00000000' }}
      />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {columns.map((c) => {
          const on = c === col
          return (
            <div
              key={c}
              testId={`quick-add-col-${c}`}
              onClick={() => setCol(c)}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 26,
                paddingLeft: 9,
                paddingRight: 10,
                borderRadius: 7,
                cursor: 'pointer',
                borderWidth: 1,
                borderColor: on ? '#FFFFFF33' : '#FFFFFF14',
                backgroundColor: on ? '#FFFFFF14' : '#00000000',
              }}
            >
              <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: COLUMN_META[c].tint }} />
              <text style={{ color: on ? T.text : T.text2, fontSize: 12 }}>{COLUMN_META[c].title}</text>
            </div>
          )
        })}
        <div style={{ flexGrow: 1 }} />
        <div
          testId="quick-add-submit"
          onClick={submit}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 28,
            paddingLeft: 12,
            paddingRight: 8,
            borderRadius: 7,
            cursor: 'pointer',
            backgroundColor: title.trim() ? '#ECEEF2' : '#FFFFFF1A',
          }}
        >
          <text style={{ color: title.trim() ? '#111318' : T.text3, fontSize: 12, fontWeight: 600 }}>Create</text>
          <Kbd>↵</Kbd>
        </div>
      </div>
    </div>
  )
}
