import * as Combobox from '@gpuix/react/combobox'
import * as Select from '@gpuix/react/select'
import { useState, type ReactNode } from 'react'
import { Avatar, Icon, LabelChip, PriorityIcon } from './components'
import { COLUMN_META, ESTIMATES, LABEL_NAMES, LABELS, PEOPLE, PRIORITIES, PRIORITY_NAMES, personName, type Card, type ColumnId, type Priority } from './data'
import { textFocus } from './focus'
import { T } from './theme'

const POPOVER = {
  minWidth: 220,
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
  borderRadius: 10,
  backgroundColor: T.popover,
  borderWidth: 1,
  borderColor: '#FFFFFF1F',
  boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: '#00000099' },
  display: 'flex' as const,
  flexDirection: 'column' as const,
}

const itemStyle = (state: { highlighted: boolean; selected: boolean }) => ({
  display: 'flex' as const,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 8,
  height: 30,
  paddingLeft: 8,
  paddingRight: 8,
  borderRadius: 6,
  cursor: 'pointer' as const,
  backgroundColor: state.highlighted ? '#FFFFFF14' : '#00000000',
})

const triggerStyle = (state: { open: boolean }) => ({
  display: 'flex' as const,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 8,
  height: 30,
  paddingLeft: 8,
  paddingRight: 8,
  borderRadius: 7,
  cursor: 'pointer' as const,
  backgroundColor: state.open ? '#FFFFFF14' : '#00000000',
  hover: { backgroundColor: '#FFFFFF0F' },
})

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: 34 }}>
      <text style={{ color: T.text3, fontSize: 12, width: 92, flexShrink: 0 }}>{label}</text>
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, alignItems: 'center' }}>{children}</div>
    </div>
  )
}

export function DetailSheet({
  width,
  card,
  column,
  columns,
  onUpdate,
  onMove,
  onComment,
  onDelete,
  onClose,
}: {
  width: number
  card: Card
  column: ColumnId
  columns: ColumnId[]
  onUpdate: (patch: Partial<Card>, message?: string) => void
  onMove: (col: ColumnId) => void
  onComment: (body: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description)
  const [editing, setEditing] = useState(card.description.length === 0)
  const [comment, setComment] = useState('')
  const [labelQuery, setLabelQuery] = useState('')

  const commitTitle = () => {
    const t = title.trim()
    if (t && t !== card.title) onUpdate({ title: t }, 'Title updated')
  }
  const commitDesc = () => {
    if (desc !== card.description) onUpdate({ description: desc }, 'Description saved')
  }
  const sendComment = () => {
    const body = comment.trim()
    if (!body) return
    onComment(body)
    setComment('')
  }

  return (
    <div
      testId="sheet"
      style={{
        width,
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: T.sheet,
        borderLeftWidth: 1,
        borderTopWidth: 1,
        borderColor: T.sheetBorder,
        borderTopLeftRadius: 12,
        boxShadow: { offsetX: -12, offsetY: 0, blurRadius: 40, spreadRadius: 0, color: '#00000066' },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 46, paddingLeft: 20, paddingRight: 12, gap: 8, flexShrink: 0 }}>
        <PriorityIcon priority={card.priority} />
        <text testId="sheet-id" style={{ color: T.text2, fontSize: 12 }}>{card.id}</text>
        <div style={{ flexGrow: 1 }} />
        <div
          testId="sheet-delete"
          onClick={onDelete}
          style={{ height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, display: 'flex', alignItems: 'center', cursor: 'pointer', hover: { backgroundColor: '#F2665F1F' } }}
        >
          <text style={{ color: T.text3, fontSize: 12 }}>Delete</text>
        </div>
        <div
          testId="sheet-close"
          onClick={onClose}
          style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', hover: { backgroundColor: '#FFFFFF14' } }}
        >
          <Icon name="close" size={14} color={T.text2} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflowY: 'scroll', paddingLeft: 20, paddingRight: 20, paddingBottom: 24, gap: 18 }}>
        <textarea
          testId="sheet-title"
          value={title}
          minRows={1}
          maxRows={3}
          onFocus={textFocus.onFocus}
          onBlur={() => {
            textFocus.onBlur()
            commitTitle()
          }}
          onChange={(e) => setTitle(e.value ?? '')}
          onSubmit={commitTitle}
          style={{ color: T.text, fontSize: 19, fontWeight: 600, lineHeight: 26, backgroundColor: '#00000000', flexShrink: 0 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
          <Row label="Status">
            <Select.Root value={column} onValueChange={(v) => onMove(v as ColumnId)}>
              <Select.Trigger testId="sheet-status" style={triggerStyle}>
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLUMN_META[column].tint }} />
                <text style={{ color: T.text, fontSize: 13 }}>{COLUMN_META[column].title}</text>
                <Icon name="chevron" size={12} color={T.text3} />
              </Select.Trigger>
              <Select.Content side="bottom" align="start" sideOffset={4} style={POPOVER}>
                {columns.map((c) => (
                  <Select.Item key={c} value={c} testId={`status-${c}`} style={itemStyle}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLUMN_META[c].tint }} />
                    <text style={{ color: T.text, fontSize: 13, flexGrow: 1 }}>{COLUMN_META[c].title}</text>
                    {c === column ? <Icon name="check" size={13} color={T.accent} /> : null}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Row>
          <Row label="Assignee">
            <Select.Root
              value={card.assignee ?? 'none'}
              onValueChange={(v) => onUpdate({ assignee: v === 'none' ? null : v }, v === 'none' ? 'Unassigned' : `Assigned to ${personName(v)}`)}
            >
              <Select.Trigger testId="sheet-assignee" style={triggerStyle}>
                <Avatar person={card.assignee} size={20} />
                <text testId="sheet-assignee-name" style={{ color: card.assignee ? T.text : T.text3, fontSize: 13 }}>{personName(card.assignee)}</text>
                <Icon name="chevron" size={12} color={T.text3} />
              </Select.Trigger>
              <Select.Content side="bottom" align="start" sideOffset={4} style={POPOVER}>
                {PEOPLE.map((p) => (
                  <Select.Item key={p.id} value={p.id} testId={`assignee-${p.id}`} style={itemStyle}>
                    <Avatar person={p.id} size={20} />
                    <text style={{ color: T.text, fontSize: 13, flexGrow: 1 }}>{p.name}</text>
                    <text style={{ color: T.text3, fontSize: 11 }}>{p.role}</text>
                  </Select.Item>
                ))}
                <Select.Item value="none" testId="assignee-none" style={itemStyle}>
                  <Avatar person={null} size={20} />
                  <text style={{ color: T.text2, fontSize: 13 }}>Unassigned</text>
                </Select.Item>
              </Select.Content>
            </Select.Root>
          </Row>
          <Row label="Priority">
            <Select.Root value={card.priority} onValueChange={(v) => onUpdate({ priority: v as Priority }, `Priority: ${PRIORITY_NAMES[v as Priority]}`)}>
              <Select.Trigger testId="sheet-priority" style={triggerStyle}>
                <PriorityIcon priority={card.priority} />
                <text style={{ color: T.text, fontSize: 13 }}>{PRIORITY_NAMES[card.priority]}</text>
                <Icon name="chevron" size={12} color={T.text3} />
              </Select.Trigger>
              <Select.Content side="bottom" align="start" sideOffset={4} style={POPOVER}>
                {PRIORITIES.map((p) => (
                  <Select.Item key={p} value={p} style={itemStyle}>
                    <PriorityIcon priority={p} />
                    <text style={{ color: T.text, fontSize: 13 }}>{PRIORITY_NAMES[p]}</text>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Row>
          <Row label="Estimate">
            <Select.Root value={String(card.estimate)} onValueChange={(v) => onUpdate({ estimate: Number(v) }, `Estimate: ${v} pts`)}>
              <Select.Trigger testId="sheet-estimate" style={triggerStyle}>
                <text style={{ color: T.text, fontSize: 13 }}>{`${card.estimate} points`}</text>
                <Icon name="chevron" size={12} color={T.text3} />
              </Select.Trigger>
              <Select.Content side="bottom" align="start" sideOffset={4} style={POPOVER}>
                {ESTIMATES.map((n) => (
                  <Select.Item key={n} value={String(n)} style={itemStyle}>
                    <text style={{ color: T.text, fontSize: 13 }}>{`${n} points`}</text>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Row>
          <Row label="Labels">
            <Combobox.Root
              multiple
              items={LABEL_NAMES}
              value={card.labels}
              onValueChange={(v) => onUpdate({ labels: Array.isArray(v) ? [...v] : [] }, 'Labels updated')}
              inputValue={labelQuery}
              onInputValueChange={setLabelQuery}
              style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}
            >
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, paddingLeft: 8, paddingTop: 4, paddingBottom: 4 }}>
                {card.labels.map((l) => (
                  <div
                    key={l}
                    testId={`sheet-label-${l}`}
                    onClick={() => onUpdate({ labels: card.labels.filter((x) => x !== l) }, `Removed ${l}`)}
                    style={{ cursor: 'pointer', borderRadius: 11, hover: { backgroundColor: '#FFFFFF0F' } }}
                  >
                    <LabelChip name={l} />
                  </div>
                ))}
                <Combobox.Input
                  testId="sheet-labels-input"
                  placeholder={card.labels.length ? 'Add…' : 'Add labels…'}
                  onFocus={textFocus.onFocus}
                  onBlur={textFocus.onBlur}
                  style={{ width: 90, height: 22, color: T.text, fontSize: 12, backgroundColor: '#00000000' }}
                />
              </div>
              <Combobox.Content side="bottom" align="start" sideOffset={4} style={POPOVER}>
                <Combobox.List style={{ display: 'flex', flexDirection: 'column' }}>
                  {(item: string) => (
                    <Combobox.Item key={item} value={item} testId={`label-option-${item}`} style={itemStyle}>
                      {(state: { selected: boolean }) => (
                        <>
                          <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LABELS[item] ?? T.text3 }} />
                          <text style={{ color: T.text, fontSize: 13, flexGrow: 1 }}>{item}</text>
                          {state.selected ? <Icon name="check" size={13} color={T.accent} /> : null}
                        </>
                      )}
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Content>
            </Combobox.Root>
          </Row>
        </div>

        <div style={{ height: 1, backgroundColor: T.hairline, flexShrink: 0 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <text style={{ color: T.text2, fontSize: 12, fontWeight: 600, flexGrow: 1 }}>Description</text>
            {(['Write', 'Preview'] as const).map((tab) => {
              const on = (tab === 'Write') === editing
              return (
                <div
                  key={tab}
                  testId={`desc-${tab.toLowerCase()}`}
                  onClick={() => {
                    if (tab === 'Preview') commitDesc()
                    setEditing(tab === 'Write')
                  }}
                  style={{
                    height: 24,
                    paddingLeft: 9,
                    paddingRight: 9,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    backgroundColor: on ? '#FFFFFF14' : '#00000000',
                  }}
                >
                  <text style={{ color: on ? T.text : T.text3, fontSize: 12 }}>{tab}</text>
                </div>
              )
            })}
          </div>
          {editing ? (
            <textarea
              testId="sheet-desc"
              value={desc}
              placeholder="Add a description… Markdown supported"
              minRows={5}
              maxRows={14}
              onFocus={textFocus.onFocus}
              onBlur={() => {
                textFocus.onBlur()
                commitDesc()
              }}
              onChange={(e) => setDesc(e.value ?? '')}
              style={{
                color: T.text,
                fontSize: 13,
                lineHeight: 20,
                paddingTop: 10,
                paddingBottom: 10,
                paddingLeft: 12,
                paddingRight: 12,
                borderRadius: 8,
                backgroundColor: T.field,
                borderWidth: 1,
                borderColor: T.fieldBorder,
              }}
            />
          ) : (
            <div
              testId="sheet-desc-preview"
              onClick={() => setEditing(true)}
              style={{ paddingTop: 2, paddingBottom: 2, cursor: 'text', minHeight: 40 }}
            >
              {desc.trim() ? (
                <markdown source={desc} style={{ color: T.text, fontSize: 13, lineHeight: 20, userSelect: 'text' }} />
              ) : (
                <text style={{ color: T.text3, fontSize: 13 }}>No description</text>
              )}
            </div>
          )}
        </div>

        <div style={{ height: 1, backgroundColor: T.hairline, flexShrink: 0 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
          <text style={{ color: T.text2, fontSize: 12, fontWeight: 600 }}>{`Activity · ${card.comments.length} ${card.comments.length === 1 ? 'comment' : 'comments'}`}</text>
          {card.comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
              <Avatar person={c.author} size={24} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <text style={{ color: T.text, fontSize: 12, fontWeight: 600 }}>{personName(c.author)}</text>
                  <text style={{ color: T.text3, fontSize: 11 }}>{c.at}</text>
                </div>
                <markdown source={c.body} style={{ color: T.text2, fontSize: 13, lineHeight: 19, userSelect: 'text' }} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar person="sofia" size={24} />
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                flexGrow: 1,
                flexShrink: 1,
                minWidth: 0,
                height: 34,
                paddingLeft: 10,
                paddingRight: 4,
                borderRadius: 8,
                backgroundColor: T.field,
                borderWidth: 1,
                borderColor: T.fieldBorder,
              }}
            >
              <input
                testId="sheet-comment"
                value={comment}
                placeholder="Leave a comment…"
                onFocus={textFocus.onFocus}
                onBlur={textFocus.onBlur}
                onChange={(e) => setComment(e.value ?? '')}
                onSubmit={sendComment}
                style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 30, color: T.text, fontSize: 13, backgroundColor: '#00000000' }}
              />
              <div
                testId="sheet-comment-send"
                onClick={sendComment}
                style={{
                  height: 26,
                  paddingLeft: 10,
                  paddingRight: 10,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  backgroundColor: comment.trim() ? '#ECEEF2' : '#FFFFFF10',
                }}
              >
                <text style={{ color: comment.trim() ? '#111318' : T.text3, fontSize: 12, fontWeight: 600 }}>Send</text>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
