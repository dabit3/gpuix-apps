import { spawn } from 'node:child_process'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  findRanges,
  motion,
  useGpuix,
  type KeyEvent,
  type StyleDesc,
} from '@gpuix/react'
import { thinkingMode, type ChatMessage, type Streamer, type Titler } from './anthropic'
import { splitSegments } from './segments'
import {
  DEFAULT_SYSTEM_PROMPT,
  apiContent,
  loadStore,
  newId,
  readAttachment,
  saveStore,
  type Attachment,
  type Message,
  type StoreData,
  type Thread,
} from './store'
import { C, CHAT_THEME, FONT_MONO, MENU } from './theme'
import { Icon, IconButton, Label, formatCount, formatMs, relativeTime } from './ui'

export const MODELS = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Best balance' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Most capable' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Fastest' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', hint: 'Previous generation' },
]

const SUGGESTIONS = [
  { title: 'Compare runtimes', prompt: 'Compare Bun, Node.js and Deno in a markdown table: startup time, package manager, TypeScript support, and Web APIs. Keep it tight.' },
  { title: 'TypeScript LRU cache', prompt: 'Write a small generic LRU cache in TypeScript with get, set and a max size. Include a short usage example.' },
  { title: 'Show me a diff', prompt: 'Show a unified diff that adds exponential-backoff retries to this function:\n\nasync function getUser(id: string) {\n  const res = await fetch(`/api/users/${id}`)\n  return res.json()\n}' },
  { title: 'Explain GPU text', prompt: 'Explain in depth how a GPU UI framework renders text: shaping, glyph atlases, subpixel positioning and batching. Use headings.' },
]

const NEW_TITLE = 'New chat'

type Streaming = {
  threadId: string
  messageId: string
  controller: AbortController
}

type Props = {
  storePath: string
  streamer: Streamer
  titler?: Titler
}

/** Copies through pbcopy: GPUIX 0.11 has no clipboard-write API. */
function copyToClipboard(text: string) {
  const child = spawn('pbcopy')
  child.on('error', () => {})
  child.stdin.end(text)
}

function historyFor(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && (!m.content.trim() || m.error)) continue
    const content = m.role === 'user' ? apiContent(m) : m.content
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${content}`
    else out.push({ role: m.role, content })
  }
  while (out.length && out[0]!.role !== 'user') out.shift()
  return out
}

function modelLabel(id: string) {
  return MODELS.find((m) => m.value === id)?.label ?? id
}

export function ClaudeDesk({ storePath, streamer, titler }: Props) {
  const { renderer } = useGpuix()
  const [data, setData] = useState<StoreData>(() => loadStore(storePath))
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findActive, setFindActive] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const composerRef = useRef<any>(null)
  const findRef = useRef<any>(null)
  const listRef = useRef<any>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const pending = useRef('')
  const pendingThinking = useRef('')

  const active = data.threads.find((t) => t.id === data.activeId) ?? null
  const messages = active?.messages ?? []

  // Persist after every change, coalesced so streaming writes ~3x a second.
  useEffect(() => {
    const timer = setTimeout(() => saveStore(storePath, data), streaming ? 300 : 0)
    return () => clearTimeout(timer)
  }, [data, storePath, streaming])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(timer)
  }, [notice])

  const updateThread = useCallback((id: string, fn: (t: Thread) => Thread) => {
    setData((d) => ({ ...d, threads: d.threads.map((t) => (t.id === id ? fn(t) : t)) }))
  }, [])

  const updateMessage = useCallback(
    (threadId: string, messageId: string, fn: (m: Message) => Message) => {
      updateThread(threadId, (t) => ({
        ...t,
        messages: t.messages.map((m) => (m.id === messageId ? fn(m) : m)),
      }))
    },
    [updateThread],
  )

  const focusComposer = useCallback(() => {
    const id = composerRef.current?.id
    if (id != null) renderer?.focusElement?.(id)
  }, [renderer])

  const newThread = useCallback(() => {
    const existing = dataRef.current.threads.find((t) => t.messages.length === 0)
    if (existing) {
      setData((d) => ({ ...d, activeId: existing.id }))
    } else {
      const now = Date.now()
      const thread: Thread = { id: newId('t'), title: NEW_TITLE, createdAt: now, updatedAt: now, messages: [] }
      setData((d) => ({ ...d, activeId: thread.id, threads: [thread, ...d.threads] }))
    }
    setFindOpen(false)
    setTimeout(focusComposer, 0)
  }, [focusComposer])

  // Swapping the empty state for the transcript (and the end of a stream) can
  // leave the composer typing but no longer dispatching Enter. Re-focus it.
  const isEmpty = messages.length === 0
  const isStreaming = streaming != null
  const overlayOpen = findOpen || settingsOpen || renamingId != null
  useEffect(() => {
    if (overlayOpen) return
    const timer = setTimeout(focusComposer, 0)
    return () => clearTimeout(timer)
  }, [isEmpty, isStreaming, data.activeId, overlayOpen, focusComposer])

  const selectThread = useCallback((id: string) => {
    setData((d) => ({ ...d, activeId: id }))
    setFindActive(0)
  }, [])

  const deleteThread = useCallback(
    (id: string) => {
      if (streaming?.threadId === id) streaming.controller.abort()
      setData((d) => {
        const index = d.threads.findIndex((t) => t.id === id)
        const threads = d.threads.filter((t) => t.id !== id)
        const activeId =
          d.activeId === id ? (threads[Math.min(index, threads.length - 1)]?.id ?? null) : d.activeId
        return { ...d, threads, activeId }
      })
    },
    [streaming],
  )

  const renameThread = useCallback(
    (id: string, title: string) => {
      const clean = title.trim()
      if (clean) updateThread(id, (t) => ({ ...t, title: clean.slice(0, 60) }))
      setRenamingId(null)
    },
    [updateThread],
  )

  const stop = useCallback(() => {
    streaming?.controller.abort()
  }, [streaming])

  const run = useCallback(
    async (threadId: string, history: ChatMessage[], messageId: string, isFirst: boolean) => {
      const controller = new AbortController()
      setStreaming({ threadId, messageId, controller })
      const model = dataRef.current.settings.model
      const started = performance.now()
      let firstTokenMs: number | null = null
      let thinkingStarted: number | null = null
      let thinkingMs: number | null = null
      let full = ''
      let inputTokens = 0
      let outputTokens = 0
      pending.current = ''
      pendingThinking.current = ''
      const flush = () => {
        if (!pending.current && !pendingThinking.current) return
        const chunk = pending.current
        const thought = pendingThinking.current
        pending.current = ''
        pendingThinking.current = ''
        updateMessage(threadId, messageId, (m) => ({
          ...m,
          content: m.content + chunk,
          thinking: thought ? (m.thinking ?? '') + thought : m.thinking,
          meta: thinkingMs != null && !m.meta ? { model, firstTokenMs, thinkingMs, totalMs: 0, inputTokens: 0, outputTokens: 0, stopReason: null } : m.meta,
        }))
      }
      const timer = setInterval(flush, 24)
      const finish = (patch: Partial<Message>, stopReason: string | null) => {
        clearInterval(timer)
        flush()
        const totalMs = performance.now() - started
        updateMessage(threadId, messageId, (m) => ({
          ...m,
          ...patch,
          meta: {
            model,
            firstTokenMs,
            thinkingMs: thinkingMs ?? (thinkingStarted != null ? performance.now() - thinkingStarted : null),
            totalMs,
            inputTokens,
            outputTokens,
            stopReason,
          },
        }))
        updateThread(threadId, (t) => ({ ...t, updatedAt: Date.now() }))
        setStreaming(null)
      }
      try {
        const usage = await streamer(
          {
            model,
            system: dataRef.current.settings.systemPrompt,
            thinking: dataRef.current.settings.thinking,
            messages: history,
            signal: controller.signal,
          },
          {
            onThinking: (delta) => {
              if (thinkingStarted == null) thinkingStarted = performance.now()
              pendingThinking.current += delta
            },
            onText: (delta) => {
              if (firstTokenMs == null) {
                firstTokenMs = performance.now() - started
                if (thinkingStarted != null) thinkingMs = performance.now() - thinkingStarted
              }
              full += delta
              pending.current += delta
            },
            onUsage: (u) => {
              if (u.inputTokens != null) inputTokens = u.inputTokens
              if (u.outputTokens != null) outputTokens = u.outputTokens
            },
          },
        )
        inputTokens = usage.inputTokens
        outputTokens = usage.outputTokens
        finish({}, usage.stopReason)
        if (isFirst && titler) {
          const title = await titler(history[history.length - 1]?.content ?? '', full)
          if (title) updateThread(threadId, (t) => (t.title === NEW_TITLE || t.title.endsWith('…') ? { ...t, title } : t))
        }
      } catch (error) {
        if (controller.signal.aborted) finish({}, 'stopped')
        else finish({ error: error instanceof Error ? error.message : String(error) }, 'error')
      }
    },
    [streamer, titler, updateMessage, updateThread],
  )

  const send = useCallback(
    (raw: string) => {
      if (streaming) return
      const text = raw.trim()
      if (!text && attachments.length === 0) return
      const now = Date.now()
      let thread = dataRef.current.threads.find((t) => t.id === dataRef.current.activeId)
      const isFirst = !thread || thread.messages.length === 0
      const user: Message = {
        id: newId('m'),
        role: 'user',
        content: text || `Please review ${attachments.map((a) => a.name).join(', ')}.`,
        attachments: attachments.length ? attachments : undefined,
      }
      const assistant: Message = { id: newId('m'), role: 'assistant', content: '' }
      const fallbackTitle = user.content.length > 40 ? `${user.content.slice(0, 40).trim()}…` : user.content
      if (!thread) {
        thread = { id: newId('t'), title: fallbackTitle, createdAt: now, updatedAt: now, messages: [] }
        const created = thread
        setData((d) => ({ ...d, activeId: created.id, threads: [created, ...d.threads] }))
      }
      const threadId = thread.id
      const history = historyFor([...thread.messages, user])
      setData((d) => ({
        ...d,
        threads: [
          ...d.threads
            .filter((t) => t.id === threadId)
            .map((t) => ({
              ...t,
              title: t.title === NEW_TITLE ? fallbackTitle : t.title,
              updatedAt: now,
              messages: [...t.messages, user, assistant],
            })),
          ...d.threads.filter((t) => t.id !== threadId),
        ],
      }))
      setDraft('')
      setAttachments([])
      void run(threadId, history, assistant.id, isFirst)
    },
    [streaming, attachments, run],
  )

  const attachPaths = useCallback((paths: string[]) => {
    const added: Attachment[] = []
    for (const p of paths) {
      try {
        added.push(readAttachment(p))
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    }
    if (added.length) {
      setAttachments((current) => [...current.filter((a) => !added.some((b) => b.path === a.path)), ...added])
      setTimeout(focusComposer, 0)
    }
  }, [focusComposer])

  const pickFiles = useCallback(async () => {
    const paths = await renderer?.promptForPaths?.({ files: true, multiple: true, prompt: 'Attach' })
    if (paths) attachPaths(paths)
  }, [renderer, attachPaths])

  // Find in thread: per-row counts from the message text, cursor across rows.
  const perRow = useMemo(
    () =>
      findOpen && findQuery
        ? messages.map((m) => findRanges({ text: m.content, query: findQuery }).length)
        : messages.map(() => 0),
    [findOpen, findQuery, messages],
  )
  const findTotal = perRow.reduce((n, c) => n + c, 0)
  const activeMatch = findTotal ? Math.min(findActive, findTotal - 1) : 0
  const rowOffsets = useMemo(() => {
    let sum = 0
    return perRow.map((c) => {
      const start = sum
      sum += c
      return start
    })
  }, [perRow])

  const goToMatch = useCallback(
    (index: number) => {
      if (!findTotal) return
      const next = ((index % findTotal) + findTotal) % findTotal
      setFindActive(next)
      const row = rowOffsets.findIndex((start, i) => next >= start && next < start + perRow[i]!)
      const id = listRef.current?.id
      if (row >= 0 && id != null) renderer?.scrollToItem?.(id, row)
    },
    [findTotal, rowOffsets, perRow, renderer],
  )

  const openFind = useCallback(() => {
    setFindOpen(true)
    setTimeout(() => {
      const id = findRef.current?.id
      if (id != null) renderer?.focusElement?.(id)
    }, 0)
  }, [renderer])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    setFindActive(0)
    focusComposer()
  }, [focusComposer])

  const onKeyDown = useCallback(
    (event: KeyEvent) => {
      const cmd = event.modifiers?.cmd
      if (cmd && event.key === 'f') {
        event.preventDefault?.()
        openFind()
      } else if (cmd && event.key === 'n') {
        event.preventDefault?.()
        newThread()
      } else if (cmd && event.key === '.' && streaming) {
        event.preventDefault?.()
        stop()
      } else if (event.key === 'escape' && findOpen) {
        closeFind()
      }
    },
    [openFind, newThread, stop, streaming, findOpen, closeFind],
  )
  windowKeys.current = onKeyDown

  return (
    <div
      testId="app"
      onKeyDown={onKeyDown}
      onFileDrop={(event) => attachPaths(event.paths ?? [])}
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: C.canvas,
      }}
    >
      <Sidebar
        threads={data.threads}
        activeId={data.activeId}
        streamingId={streaming?.threadId ?? null}
        renamingId={renamingId}
        onNew={newThread}
        onSelect={selectThread}
        onRename={renameThread}
        onStartRename={setRenamingId}
        onDelete={deleteThread}
        onSettings={() => setSettingsOpen(true)}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minWidth: 0,
          height: '100%',
          position: 'relative',
        }}
      >
        <Header
          title={active?.title ?? 'Claude Desk'}
          count={messages.length}
          findOpen={findOpen}
          onFind={() => (findOpen ? closeFind() : openFind())}
        />
        {findOpen && (
          <FindBar
            inputRef={findRef}
            query={findQuery}
            total={findTotal}
            active={activeMatch}
            onChange={(q) => {
              setFindQuery(q)
              setFindActive(0)
            }}
            onNext={() => goToMatch(activeMatch + 1)}
            onPrev={() => goToMatch(activeMatch - 1)}
            onClose={closeFind}
          />
        )}
        {messages.length === 0 ? (
          <EmptyState onPick={send} model={data.settings.model} />
        ) : (
          <virtual-list
            ref={listRef}
            testId="transcript"
            alignment="bottom"
            followTail
            overdraw={600}
            estimatedItemHeight={160}
            style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
          >
            {messages.map((m, i) => {
              const count = perRow[i] ?? 0
              const start = rowOffsets[i] ?? 0
              const highlight =
                count > 0
                  ? {
                      query: findQuery,
                      color: '#D9775740',
                      activeColor: '#D97757B0',
                      activeIndex: activeMatch >= start && activeMatch < start + count ? activeMatch - start : undefined,
                    }
                  : null
              return (
                <MessageRow
                  key={m.id}
                  message={m}
                  last={i === messages.length - 1}
                  streaming={streaming?.messageId === m.id}
                  highlight={highlight}
                  onCopy={() => {
                    copyToClipboard(m.content)
                    setNotice('Copied to clipboard')
                  }}
                />
              )
            })}
          </virtual-list>
        )}
        <Composer
          inputRef={composerRef}
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={stop}
          streaming={!!streaming}
          attachments={attachments}
          onRemoveAttachment={(p) => setAttachments((list) => list.filter((a) => a.path !== p))}
          onAttach={pickFiles}
          model={data.settings.model}
          onModel={(model) => {
            setData((d) => ({ ...d, settings: { ...d.settings, model } }))
            setTimeout(focusComposer, 60)
          }}
          thinking={data.settings.thinking}
          onThinking={(thinking) => {
            setData((d) => ({ ...d, settings: { ...d.settings, thinking } }))
            setTimeout(focusComposer, 0)
          }}
        />
        {notice && (
          <div
            testId="notice"
            style={{
              position: 'absolute',
              top: 58,
              right: 20,
              paddingLeft: 12,
              paddingRight: 12,
              height: 30,
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              backgroundColor: C.raised,
              borderWidth: 1,
              borderColor: C.borderStrong,
            }}
          >
            <Icon name="check" size={13} color={C.success} />
            <Label size={12.5} color={C.text}>{notice}</Label>
          </div>
        )}
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        systemPrompt={data.settings.systemPrompt}
        storePath={storePath}
        onSave={(systemPrompt) => {
          setData((d) => ({ ...d, settings: { ...d.settings, systemPrompt } }))
          setSettingsOpen(false)
          setNotice('System prompt saved')
        }}
      />
    </div>
  )
}

/** Window-level shortcut target for `render({ onKeyDown })`. */
export const windowKeys: { current: ((event: KeyEvent) => void) | null } = { current: null }

function Sidebar({
  threads,
  activeId,
  streamingId,
  renamingId,
  onNew,
  onSelect,
  onRename,
  onStartRename,
  onDelete,
  onSettings,
}: {
  threads: Thread[]
  activeId: string | null
  streamingId: string | null
  renamingId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onStartRename: (id: string | null) => void
  onDelete: (id: string) => void
  onSettings: () => void
}) {
  return (
    <div
      testId="sidebar"
      style={{
        width: 256,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: C.sidebar,
        borderRightWidth: 1,
        borderColor: C.border,
      }}
    >
      <div style={{ height: 52, flexShrink: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10 }}>
        <IconButton icon="compose" testId="new-thread" onClick={onNew} iconSize={16} color={C.secondary} />
      </div>
      <div style={{ paddingLeft: 18, paddingBottom: 6, paddingTop: 2 }}>
        <Label size={11.5} color={C.tertiary} weight={600}>
          Chats
        </Label>
      </div>
      <div
        testId="thread-list"
        style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', display: 'flex', flexDirection: 'column', paddingLeft: 8, paddingRight: 8, gap: 1 }}
      >
        {threads.length === 0 && (
          <div style={{ paddingLeft: 10, paddingTop: 6 }}>
            <Label size={12.5} color={C.ghost}>No chats yet</Label>
          </div>
        )}
        {threads.map((t, i) => (
          <ThreadRow
            key={t.id}
            index={i}
            thread={t}
            active={t.id === activeId}
            streaming={t.id === streamingId}
            renaming={t.id === renamingId}
            onSelect={onSelect}
            onRename={onRename}
            onStartRename={onStartRename}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div style={{ flexShrink: 0, borderTopWidth: 1, borderColor: C.border, padding: 8 }}>
        <div
          testId="open-settings"
          onClick={onSettings}
          style={{
            height: 34,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            paddingLeft: 10,
            cursor: 'pointer',
            hover: { backgroundColor: C.hover },
          }}
        >
          <Icon name="settings" size={15} color={C.secondary} />
          <Label size={13} color={C.secondary}>System prompt</Label>
        </div>
      </div>
    </div>
  )
}

const ThreadRow = memo(function ThreadRow({
  index,
  thread,
  active,
  streaming,
  renaming,
  onSelect,
  onRename,
  onStartRename,
  onDelete,
}: {
  index: number
  thread: Thread
  active: boolean
  streaming: boolean
  renaming: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onStartRename: (id: string | null) => void
  onDelete: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [value, setValue] = useState(thread.title)
  useEffect(() => {
    if (renaming) setValue(thread.title)
  }, [renaming, thread.title])

  if (renaming) {
    return (
      <div style={{ height: 34, display: 'flex', alignItems: 'center', paddingLeft: 4, paddingRight: 4, borderRadius: 8, backgroundColor: C.selected }}>
        <input
          testId={`rename-input-${index}`}
          value={value}
          autoFocus
          theme={CHAT_THEME}
          onChange={(e) => setValue(e.value ?? '')}
          onSubmit={(e) => onRename(thread.id, e.value ?? value)}
          onBlur={() => onRename(thread.id, value)}
          onKeyDown={(e) => {
            if (e.key === 'escape') onStartRename(null)
          }}
          style={{
            width: '100%',
            height: 26,
            fontSize: 13,
            color: C.text,
            paddingLeft: 6,
            paddingRight: 6,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.accent,
            backgroundColor: C.canvas,
          }}
        />
      </div>
    )
  }

  const showActions = hovered || active
  return (
    <div
      testId={`thread-${index}`}
      onClick={(e) => {
        if (e.clickCount === 2) onStartRename(thread.id)
        else onSelect(thread.id)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 34,
        flexShrink: 0,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 10,
        paddingRight: 4,
        gap: 8,
        cursor: 'pointer',
        backgroundColor: active ? C.selected : '#00000000',
        hover: { backgroundColor: active ? C.selected : C.hover },
      }}
    >
      {streaming && <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, flexShrink: 0 }} />}
      <text
        testId={`thread-title-${index}`}
        style={{
          flexGrow: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 18,
          color: active ? C.text : C.secondary,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
        }}
      >
        {thread.title}
      </text>
      {showActions ? (
        <div style={{ display: 'flex', flexDirection: 'row', flexShrink: 0 }}>
          <IconButton icon="pencil" testId={`rename-${index}`} size={24} iconSize={12.5} onClick={() => onStartRename(thread.id)} />
          <IconButton icon="trash" testId={`delete-${index}`} size={24} iconSize={12.5} onClick={() => onDelete(thread.id)} />
        </div>
      ) : (
        <Label size={11.5} color={C.ghost} style={{ flexShrink: 0, paddingRight: 6 }}>
          {relativeTime(thread.updatedAt)}
        </Label>
      )}
    </div>
  )
})

function Header({ title, count, findOpen, onFind }: { title: string; count: number; findOpen: boolean; onFind: () => void }) {
  return (
    <div
      style={{
        height: 52,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 22,
        paddingRight: 12,
        gap: 10,
        borderBottomWidth: 1,
        borderColor: C.border,
      }}
    >
      <text testId="thread-title" style={{ fontSize: 13.5, lineHeight: 18, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', minWidth: 0 }}>
        {title}
      </text>
      {count > 0 && (
        <text testId="message-count" style={{ fontSize: 12, lineHeight: 16, color: C.tertiary, flexShrink: 0 }}>
          {`${count} message${count === 1 ? '' : 's'}`}
        </text>
      )}
      <div style={{ flexGrow: 1 }} />
      <IconButton icon="search" testId="find-toggle" onClick={onFind} active={findOpen} />
    </div>
  )
}

function FindBar({
  inputRef,
  query,
  total,
  active,
  onChange,
  onNext,
  onPrev,
  onClose,
}: {
  inputRef: React.RefObject<any>
  query: string
  total: number
  active: number
  onChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}) {
  return (
    <div
      testId="find-bar"
      style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 18,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderColor: C.border,
        backgroundColor: C.sidebar,
      }}
    >
      <Icon name="search" size={13} color={C.tertiary} />
      <input
        ref={inputRef}
        testId="find-input"
        value={query}
        placeholder="Find in chat"
        theme={CHAT_THEME}
        onChange={(e) => onChange(e.value ?? '')}
        onSubmit={() => onNext()}
        onKeyDown={(e) => {
          if (e.key === 'escape') onClose()
          if (e.key === 'enter' && e.modifiers?.shift) {
            e.preventDefault?.()
            onPrev()
          }
        }}
        style={{ flexGrow: 1, height: 28, fontSize: 13, color: C.text, backgroundColor: '#00000000', borderWidth: 0, paddingLeft: 4 }}
      />
      <text testId="find-count" style={{ fontSize: 12, lineHeight: 16, color: total ? C.secondary : C.tertiary, fontFamily: FONT_MONO, flexShrink: 0 }}>
        {query ? (total ? `${active + 1} of ${total}` : 'No matches') : ''}
      </text>
      <IconButton icon="chevronUp" testId="find-prev" size={26} iconSize={14} onClick={onPrev} disabled={!total} />
      <IconButton icon="chevronDown" testId="find-next" size={26} iconSize={14} onClick={onNext} disabled={!total} />
      <IconButton icon="x" testId="find-close" size={26} iconSize={14} onClick={onClose} />
    </div>
  )
}

function EmptyState({ onPick, model }: { onPick: (prompt: string) => void; model: string }) {
  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, paddingBottom: 30 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={22} color={C.accent} />
        </div>
        <Label size={22} weight={600} color={C.text}>How can I help?</Label>
        <Label size={13} color={C.tertiary}>{`${modelLabel(model)} · streaming from the Anthropic API`}</Label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, maxWidth: 640 }}>
        {SUGGESTIONS.map((s, i) => (
          <div
            key={s.title}
            testId={`suggestion-${i}`}
            onClick={() => onPick(s.prompt)}
            style={{
              width: 300,
              paddingLeft: 14,
              paddingRight: 14,
              paddingTop: 11,
              paddingBottom: 11,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.sidebar,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              cursor: 'pointer',
              hover: { backgroundColor: C.hover, borderColor: C.borderStrong },
            }}
          >
            <Label size={13} weight={600} color={C.text}>{s.title}</Label>
            <text style={{ fontSize: 12, lineHeight: 17, color: C.tertiary, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {s.prompt.split('\n')[0]}
            </text>
          </div>
        ))}
      </div>
    </div>
  )
}

const ROW: StyleDesc = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingLeft: 32,
  paddingRight: 32,
}

const MessageRow = memo(function MessageRow({
  message,
  last,
  streaming,
  highlight,
  onCopy,
}: {
  message: Message
  last: boolean
  streaming: boolean
  highlight: { query: string; color: string; activeColor: string; activeIndex?: number } | null
  onCopy: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const isUser = message.role === 'user'
  return (
    <div
      style={{ ...ROW, paddingTop: isUser ? 22 : 10, paddingBottom: last ? 28 : 8 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        testId={`message-${message.role}`}
        highlight={highlight}
        style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'stretch', userSelect: 'text', selectionColor: '#D977574D' }}
      >
        {isUser ? <UserBubble message={message} /> : <AssistantBody message={message} streaming={streaming} />}
        {!streaming && (message.content || message.error) && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 26, marginTop: 4, opacity: hovered || !isUser ? 1 : 0 }}>
            <CopyButton onCopy={onCopy} />
            {!isUser && message.meta && <ReplyMeta meta={message.meta} />}
          </div>
        )}
      </div>
    </div>
  )
})

function CopyButton({ onCopy }: { onCopy: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      testId="copy-message"
      size={24}
      iconSize={13}
      color={copied ? C.success : C.tertiary}
      onClick={() => {
        onCopy()
        setCopied(true)
      }}
    />
  )
}

function ReplyMeta({ meta }: { meta: NonNullable<Message['meta']> }) {
  const tps = meta.outputTokens && meta.firstTokenMs != null && meta.totalMs > meta.firstTokenMs
    ? meta.outputTokens / ((meta.totalMs - meta.firstTokenMs) / 1000)
    : null
  const parts = [
    modelLabel(meta.model),
    `${formatMs(meta.firstTokenMs)} to first token`,
    formatMs(meta.totalMs),
    `${formatCount(meta.inputTokens)} in · ${formatCount(meta.outputTokens)} out`,
  ]
  if (tps) parts.push(`${Math.round(tps)} tok/s`)
  if (meta.thinkingMs) parts.splice(1, 0, `thought ${formatMs(meta.thinkingMs)}`)
  if (meta.stopReason === 'stopped') parts.push('Stopped')
  if (meta.stopReason === 'max_tokens') parts.push('Hit max tokens')
  return (
    <text testId="reply-meta" style={{ fontSize: 11.5, lineHeight: 16, color: C.ghost, whiteSpace: 'nowrap', userSelect: 'none' }}>
      {parts.join('  ·  ')}
    </text>
  )
}

function UserBubble({ message }: { message: Message }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: 560 }}>
      {message.attachments?.map((a) => (
        <AttachmentChip key={a.path} attachment={a} />
      ))}
      <div style={{ backgroundColor: C.userBubble, borderRadius: 16, paddingLeft: 15, paddingRight: 15, paddingTop: 9, paddingBottom: 9 }}>
        <text style={{ fontSize: 14, lineHeight: 21, color: C.text }}>{message.content}</text>
      </div>
    </div>
  )
}

function AssistantBody({ message, streaming }: { message: Message; streaming: boolean }) {
  const segments = useMemo(() => splitSegments(message.content), [message.content])
  if (!message.content && streaming && message.thinking) {
    return <ThinkingBlock text={message.thinking} live />
  }
  if (!message.content && streaming) {
    return (
      <div testId="thinking" style={{ height: 28, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pulse style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
        <Label size={13} color={C.tertiary}>Thinking…</Label>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {message.thinking && <ThinkingBlock text={message.thinking} ms={message.meta?.thinkingMs ?? null} />}
      {segments.map((s, i) =>
        s.kind === 'markdown' ? (
          <markdown key={i} source={s.source} theme={CHAT_THEME} style={{ width: '100%' }} />
        ) : (
          <diff
            key={i}
            patch={s.patch}
            wordDiff
            theme={CHAT_THEME}
            style={{ width: '100%', borderRadius: 10, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}
          />
        ),
      )}
      {streaming && (
        <Pulse style={{ width: 8, height: 16, borderRadius: 2, backgroundColor: C.accent }} />
      )}
      {message.error && (
        <div testId="reply-error" style={{ borderRadius: 10, borderWidth: 1, borderColor: '#E5484D55', backgroundColor: '#E5484D14', paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 9 }}>
          <Label size={13} color="#FF8B8E">{message.error}</Label>
        </div>
      )}
    </div>
  )
}

function ThinkingBlock({ text, live, ms }: { text: string; live?: boolean; ms?: number | null }) {
  const [open, setOpen] = useState(false)
  const lines = text.trim().split('\n').filter(Boolean)
  const tail = live ? lines.slice(-4).join('\n') : text.trim()
  return (
    <div testId="thinking-block" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        testId="thinking-header"
        onClick={live ? undefined : () => setOpen((v) => !v)}
        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 24, cursor: live ? 'default' : 'pointer' }}
      >
        {live ? (
          <Pulse style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
        ) : (
          <Icon name="sparkle" size={13} color={C.tertiary} />
        )}
        <Label size={13} color={C.tertiary}>{live ? 'Thinking…' : `Thought for ${formatMs(ms ?? null)}`}</Label>
        {!live && <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} color={C.ghost} />}
      </div>
      {(live || open) && (
        <div style={{ borderLeftWidth: 2, borderColor: C.borderStrong, paddingLeft: 12, marginLeft: 3 }}>
          <text style={{ fontSize: 12.5, lineHeight: 19, color: C.tertiary }}>{tail}</text>
        </div>
      )}
    </div>
  )
}

/** Native opacity tween, retargeted every half second. */
function Pulse({ style }: { style: StyleDesc }) {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const timer = setInterval(() => setOn((v) => !v), 520)
    return () => clearInterval(timer)
  }, [])
  return <motion.div animate={{ opacity: on ? 1 : 0.2 }} transition={{ duration: 0.5, ease: 'easeInOut' }} style={style} />
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  return (
    <div
      testId="attachment"
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 34,
        paddingLeft: 10,
        paddingRight: onRemove ? 4 : 12,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: C.borderStrong,
        backgroundColor: C.raised,
      }}
    >
      <Icon name="file" size={14} color={C.accent} />
      <Label size={12.5} color={C.text} weight={500}>{attachment.name}</Label>
      <Label size={11.5} color={C.tertiary}>{`${formatCount(attachment.lines)} lines`}</Label>
      {onRemove && <IconButton icon="x" testId="remove-attachment" size={22} iconSize={12} onClick={onRemove} />}
    </div>
  )
}

function Composer({
  inputRef,
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  attachments,
  onRemoveAttachment,
  onAttach,
  model,
  onModel,
  thinking,
  onThinking,
}: {
  inputRef: React.RefObject<any>
  value: string
  onChange: (v: string) => void
  onSend: (v: string) => void
  onStop: () => void
  streaming: boolean
  attachments: Attachment[]
  onRemoveAttachment: (path: string) => void
  onAttach: () => void
  model: string
  onModel: (m: string) => void
  thinking: boolean
  onThinking: (on: boolean) => void
}) {
  const mode = thinkingMode(model)
  const thinkingOn = mode === 'always' || (mode !== 'none' && thinking)
  const canSend = !streaming && (value.trim().length > 0 || attachments.length > 0)
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingLeft: 32, paddingRight: 32, paddingBottom: 18, paddingTop: 6 }}>
      <div
        style={{
          width: '100%',
          maxWidth: 760,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          paddingTop: 10,
          paddingBottom: 8,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: C.borderStrong,
          backgroundColor: C.raised,
        }}
      >
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 4 }}>
            {attachments.map((a) => (
              <AttachmentChip key={a.path} attachment={a} onRemove={() => onRemoveAttachment(a.path)} />
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          testId="composer"
          value={value}
          placeholder="Message Claude"
          minRows={1}
          maxRows={8}
          autoFocus
          theme={CHAT_THEME}
          style={{ width: '100%', minWidth: 0, fontSize: 14, lineHeight: 21, color: C.text, backgroundColor: '#00000000', borderWidth: 0, paddingLeft: 8, paddingRight: 8 }}
          onChange={(e) => onChange(e.value ?? '')}
          onSubmit={(e) => onSend(e.value ?? value)}
        />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <IconButton icon="paperclip" testId="attach" onClick={onAttach} iconSize={15} />
          <ModelPicker value={model} onChange={onModel} />
          {mode !== 'none' && (
            <div
              testId="thinking-toggle"
              onClick={mode === 'always' ? undefined : () => onThinking(!thinking)}
              style={{
                height: 28,
                paddingLeft: 8,
                paddingRight: 9,
                borderRadius: 7,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                cursor: mode === 'always' ? 'default' : 'pointer',
                backgroundColor: thinkingOn ? C.accentSoft : '#00000000',
                hover: { backgroundColor: thinkingOn ? '#D9775738' : C.overlay },
              }}
            >
              <Icon name="sparkle" size={13} color={thinkingOn ? C.accent : C.tertiary} />
              <text style={{ fontSize: 12.5, lineHeight: 16, color: thinkingOn ? C.accent : C.secondary }}>
                {thinkingOn ? 'Thinking on' : 'Thinking'}
              </text>
            </div>
          )}
          <div style={{ flexGrow: 1 }} />
          {streaming ? (
            <div
              testId="stop"
              onClick={onStop}
              style={{ height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: 15, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.text, cursor: 'pointer', hover: { backgroundColor: '#FFFFFF' } }}
            >
              <Icon name="stop" size={12} color={C.canvas} />
              <Label size={12.5} weight={600} color={C.canvas}>Stop</Label>
            </div>
          ) : (
            <div
              testId="send"
              onClick={canSend ? () => onSend(value) : undefined}
              style={{ width: 30, height: 30, borderRadius: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? C.accent : C.overlay, cursor: canSend ? 'pointer' : 'default' }}
            >
              <Icon name="arrowUp" size={16} color={canSend ? '#FFFFFF' : C.ghost} />
            </div>
          )}
        </div>
      </div>
      <text style={{ fontSize: 11, lineHeight: 15, color: C.ghost, marginTop: 8 }}>
        Enter to send · Shift+Enter for a new line · Drop a file to attach · ⌘F to find
      </text>
    </div>
  )
}

function ModelPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const items = MODELS.map((m) => ({ value: m.value, label: m.label }))
  return (
    <Select items={items} value={value} onValueChange={onChange} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId="model-picker"
          style={(state) => ({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 28,
            paddingLeft: 9,
            paddingRight: 8,
            borderRadius: 7,
            cursor: 'pointer',
            backgroundColor: state.open ? C.overlay : '#00000000',
            hover: { backgroundColor: C.overlay },
          })}
        >
          <text testId="model-label" style={{ fontSize: 12.5, lineHeight: 16, color: C.secondary, whiteSpace: 'nowrap' }}>
            {modelLabel(value)}
          </text>
          <Icon name="chevronDown" size={11} color={C.tertiary} />
        </SelectTrigger>
        <SelectContent side="top" sideOffset={6} style={MENU}>
          {MODELS.map((m) => (
            <SelectItem
              key={m.value}
              value={m.value}
              testId={`model-${m.value}`}
              style={(state) => ({
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                height: 40,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: 7,
                cursor: 'pointer',
                backgroundColor: state.highlighted ? C.overlay : '#00000000',
              })}
            >
              {(state) => (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                    <Label size={13} color={C.text}>{m.label}</Label>
                    <Label size={11.5} color={C.tertiary}>{m.hint}</Label>
                  </div>
                  {state.selected && <Icon name="check" size={14} color={C.accent} />}
                </>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
  )
}

function SettingsDialog({
  open,
  onOpenChange,
  systemPrompt,
  storePath,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  systemPrompt: string
  storePath: string
  onSave: (prompt: string) => void
}) {
  const [value, setValue] = useState(systemPrompt)
  useEffect(() => {
    if (open) setValue(systemPrompt)
  }, [open, systemPrompt])
  const button = (primary: boolean): StyleDesc => ({
    height: 30,
    paddingLeft: 14,
    paddingRight: 14,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backgroundColor: primary ? C.accent : C.overlay,
    hover: { backgroundColor: primary ? '#E2856A' : '#363636' },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop style={{ backgroundColor: '#00000099' }} />
        <DialogPopup
          testId="settings-dialog"
          style={{ width: 540, padding: 20, borderRadius: 14, backgroundColor: C.raised, borderWidth: 1, borderColor: C.borderStrong, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <DialogTitle>
            <Label size={15} weight={600} color={C.text}>System prompt</Label>
          </DialogTitle>
          <Label size={12.5} color={C.tertiary}>Sent with every message in every chat.</Label>
          <div style={{ borderRadius: 10, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.canvas, paddingTop: 8, paddingBottom: 8, paddingLeft: 4, paddingRight: 4 }}>
            <textarea
              testId="system-prompt"
              value={value}
              minRows={6}
              maxRows={12}
              theme={CHAT_THEME}
              onChange={(e) => setValue(e.value ?? '')}
              style={{ width: '100%', fontSize: 13, lineHeight: 19, color: C.text, backgroundColor: '#00000000', borderWidth: 0, paddingLeft: 8, paddingRight: 8 }}
            />
          </div>
          <text style={{ fontSize: 11, lineHeight: 15, color: C.ghost, fontFamily: FONT_MONO }}>{storePath}</text>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <div testId="reset-system-prompt" onClick={() => setValue(DEFAULT_SYSTEM_PROMPT)} style={{ ...button(false), backgroundColor: '#00000000' }}>
              <Label size={12.5} color={C.secondary}>Reset to default</Label>
            </div>
            <div style={{ flexGrow: 1 }} />
            <DialogClose testId="cancel-settings" style={button(false)}>
              <Label size={12.5} color={C.text}>Cancel</Label>
            </DialogClose>
            <div testId="save-settings" onClick={() => onSave(value)} style={button(true)}>
              <Label size={12.5} weight={600} color="#FFFFFF">Save</Label>
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
