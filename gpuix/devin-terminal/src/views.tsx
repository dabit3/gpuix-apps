/** @jsxImportSource #zoom */
// Full-page views behind the sidebar nav, Settings and the bell. Everything here talks to the real Devin v3 API when one is configured.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@gpuix/react'
import { Icon, type IconName } from './icons'
import { C, nativeTheme } from './theme'
import { DevinClient, describeTrigger, SCHEDULE_PRESETS, timeAgo, type ApiAutomation, type ApiNote, type ApiPlaybook, type ApiSecret, type ApiTemplate, type DevinApi } from './api'
import type { Session } from './data'
import { FindingsList } from './more'
import { stepZoom } from './zoom/scale'
import { Badge, Btn, Card, CLEAR, col, Empty, EmptyState, Field, IconButton, IconTile, Kbd, ListRow, Notice, openUrl, Pills, row, SANS, SecretField, SectionTitle, Segmented, T, Tabs, Toggle, WEB } from './ui'

// View-local UI state that survives the theme toggle (which remounts the tree so memoized rows repaint).
const sticky = new Map<string, unknown>()
export function useSticky<S>(key: string, initial: S): [S, (v: S | ((s: S) => S)) => void] {
  const [v, setV] = useState<S>(() => (sticky.has(key) ? (sticky.get(key) as S) : initial))
  const set = useCallback((next: S | ((s: S) => S)) => {
    setV((cur) => {
      const val = typeof next === 'function' ? (next as (s: S) => S)(cur) : next
      sticky.set(key, val)
      return val
    })
  }, [key])
  return [v, set]
}

export type View = 'home' | 'automations' | 'security' | 'review' | 'customize' | 'settings' | 'notifications' | 'sessions' | 'usage' | 'repos' | 'environment'

/** Copies over OSC 52 (works over SSH in Ghostty/kitty) and, locally on macOS, via pbcopy. */
export function copyText(text: string) {
  if (typeof Bun === 'undefined' || process.env.NODE_ENV === 'test') return
  try {
    require('fs').writeFileSync('/dev/tty', `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
  } catch {}
  if (process.platform === 'darwin') {
    try {
      const p = Bun.spawn(['pbcopy'], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
      p.stdin.write(text)
      p.stdin.end()
    } catch {}
  }
}

export function Page({ title, subtitle, actions, children, testId, narrow }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; testId: string; narrow?: boolean }) {
  return (
    <div testId={testId} style={{ ...col(), flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: C.borderStrong }}>
      <div style={{ ...col({ gap: 20 }), width: '100%', maxWidth: 880, alignSelf: 'center', paddingLeft: narrow ? 18 : 40, paddingRight: narrow ? 18 : 40, paddingTop: narrow ? 20 : 34, paddingBottom: 48 }}>
        <div style={row({ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' })}>
          <div style={col({ gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 220 })}>
            <T size={20} weight={600} style={{ lineHeight: 28 }}>{title}</T>
            {subtitle && <T size={13} color={C.tertiary}>{subtitle}</T>}
          </div>
          {actions && <div style={{ ...row({ gap: 8 }), paddingTop: 2 }}>{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}

/** Loads a list from an optional API method; `null` api → [] with a hint. */
export function useApiList<T>(load: (() => Promise<T[]>) | undefined, deps: unknown[] = []) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    if (!load) {
      setItems([])
      return
    }
    load()
      .then((v) => {
        setItems(v)
        setError(null)
      })
      .catch((e) => setError(String(e?.message ?? e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(reload, [reload])
  return { items, error, reload, setItems }
}

function Label({ children }: { children: string }) {
  return <T size={12.5} weight={500} color={C.secondary}>{children}</T>
}

function FormCard({ testId, title, children, footer }: { testId: string; title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div testId={testId} style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={{ ...col({ gap: 12 }), padding: 16 }}>
        <T size={14} weight={600}>{title}</T>
        {children}
      </div>
      <div style={{ ...row({ gap: 8, justifyContent: 'flex-end' }), paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.cardHead }}>{footer}</div>
    </div>
  )
}

/* ───────────────────────────── Automations ───────────────────────────── */

export function AutomationsView({ api, narrow }: { api: DevinApi | null; narrow?: boolean }) {
  const autos = useApiList<ApiAutomation>(api?.listAutomations?.bind(api), [api])
  const templates = useApiList<ApiTemplate>(api?.listTemplates?.bind(api), [api])
  const [tab, setTab] = useSticky<'automations' | 'templates'>('auto.tab', 'automations')
  const [creating, setCreating] = useSticky('auto.creating', false)
  const [name, setName] = useSticky('auto.name', '')
  const [prompt, setPrompt] = useSticky('auto.prompt', '')
  const [preset, setPreset] = useSticky('auto.preset', SCHEDULE_PRESETS[0]!.id)
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  const [category, setCategory] = useSticky('auto.category', 'all')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const categories = useMemo(() => ['all', ...new Set((templates.items ?? []).map((t) => t.category))], [templates.items])
  const shownTemplates = (templates.items ?? []).filter((t) => category === 'all' || t.category === category)

  const create = async () => {
    if (!api?.createAutomation || !name.trim() || !prompt.trim()) return
    const rrule = SCHEDULE_PRESETS.find((p) => p.id === preset)!.rrule
    try {
      const a = await api.createAutomation({ name: name.trim(), rrule, prompt: prompt.trim() })
      autos.setItems((xs) => [a, ...(xs ?? [])])
      setNotice({ text: `Created “${a.name}”`, tone: 'ok' })
      setCreating(false)
      setName('')
      setPrompt('')
    } catch (e) {
      setNotice({ text: String((e as Error).message), tone: 'error' })
    }
  }
  const toggle = async (a: ApiAutomation, enabled: boolean) => {
    autos.setItems((xs) => (xs ?? []).map((x) => (x.automation_id === a.automation_id ? { ...x, enabled } : x)))
    try {
      await api?.setAutomationEnabled?.(a.automation_id, enabled)
      setNotice({ text: `${enabled ? 'Enabled' : 'Paused'} “${a.name}”`, tone: 'ok' })
    } catch (e) {
      autos.setItems((xs) => (xs ?? []).map((x) => (x.automation_id === a.automation_id ? { ...x, enabled: !enabled } : x)))
      setNotice({ text: String((e as Error).message), tone: 'error' })
    }
  }
  const remove = async (a: ApiAutomation) => {
    if (confirmDelete !== a.automation_id) return setConfirmDelete(a.automation_id)
    setConfirmDelete(null)
    try {
      await api?.deleteAutomation?.(a.automation_id)
      autos.setItems((xs) => (xs ?? []).filter((x) => x.automation_id !== a.automation_id))
      setNotice({ text: `Deleted “${a.name}”`, tone: 'ok' })
    } catch (e) {
      setNotice({ text: String((e as Error).message), tone: 'error' })
    }
  }

  return (
    <Page
      testId="view-automations"
      narrow={narrow}
      title="Automations"
      subtitle="Run Devin on a schedule or when something happens in your tools."
      actions={<Btn testId="automation-new" primary icon="plus" label="New automation" onClick={() => setCreating((v) => !v)} />}
    >
      {!api && <Notice text="Automations need a Devin API key. Add one in Settings → Devin API." />}
      {creating && (
        <FormCard
          testId="automation-form"
          title="New scheduled automation"
          footer={
            <>
              <Btn label="Cancel" ghost onClick={() => setCreating(false)} />
              <Btn testId="automation-create" primary label="Create automation" disabled={!name.trim() || !prompt.trim()} onClick={create} />
            </>
          }
        >
          <div style={col({ gap: 6 })}>
            <Label>Name</Label>
            <Field testId="automation-name" value={name} onChange={setName} placeholder="Weekday test run" />
          </div>
          <div style={col({ gap: 6 })}>
            <Label>Prompt</Label>
            <Field testId="automation-prompt" value={prompt} onChange={setPrompt} placeholder="What should Devin do each run?" multiline />
          </div>
          <div style={col({ gap: 6 })}>
            <Label>Schedule</Label>
            <Pills testId="automation-schedule" items={SCHEDULE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={preset} onChange={setPreset} />
          </div>
        </FormCard>
      )}
      {notice && <Notice text={notice.text} tone={notice.tone} />}
      <Tabs
        testId="automations-tab"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'automations', label: 'Your automations', count: autos.items?.length },
          { value: 'templates', label: 'Templates', count: templates.items?.length },
        ]}
      />
      {tab === 'automations' ? (
        <div style={col({ gap: 8 })}>
          {autos.error && <Notice text={autos.error} tone="error" />}
          {autos.items === null ? (
            <Empty text="Loading automations…" />
          ) : autos.items.length === 0 ? (
            <EmptyState icon="clock" title="No automations yet" body="Schedule a recurring session, or start from a template." action={<Btn small label="Browse templates" onClick={() => setTab('templates')} />} />
          ) : (
            autos.items.map((a) => (
              <Card key={a.automation_id} testId={`automation-${a.automation_id}`} style={{ ...row({ gap: 12, alignItems: 'flex-start' }), paddingTop: 12, paddingBottom: 12 }}>
                <IconTile icon="clock" color={a.enabled ? C.add : C.ghost} bg={a.enabled ? C.greenSoft : undefined} size={32} />
                <div style={col({ gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 })}>
                  <div style={row({ gap: 8 })}>
                    <T weight={500} style={{ flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{a.name}</T>
                    {!a.enabled && <Badge label="Paused" />}
                  </div>
                  <T size={12.5} color={C.tertiary}>{`${a.triggers.map(describeTrigger).join(' · ') || 'No trigger'} · updated ${timeAgo(a.updated_at)}`}</T>
                  {a.actions[0]?.prompt && (
                    <T size={12.5} color={C.secondary} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>
                      {a.actions[0].prompt.replace(/\s+/g, ' ').slice(0, 220)}
                    </T>
                  )}
                </div>
                <div style={{ ...row({ gap: 6 }), height: 32 }}>
                  <Toggle testId={`automation-toggle-${a.automation_id}`} on={a.enabled} onChange={(v) => toggle(a, v)} />
                  {confirmDelete === a.automation_id ? (
                    <Btn small danger testId={`automation-delete-${a.automation_id}`} label="Delete" icon="trash" onClick={() => remove(a)} />
                  ) : (
                    <IconButton icon="trash" size={15} box={28} tip="Delete automation" testId={`automation-delete-${a.automation_id}`} onClick={() => remove(a)} />
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        <div style={col({ gap: 12 })}>
          <Pills testId="template-cat" value={category} onChange={setCategory} items={categories.map((c) => ({ value: c, label: c === 'all' ? 'All' : c.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase()) }))} />
          {templates.items === null ? (
            <Empty text="Loading templates…" />
          ) : shownTemplates.length === 0 ? (
            <EmptyState icon="shapes" title="No templates" body={api ? 'Nothing in this category yet.' : 'Connect a Devin API key to browse templates.'} />
          ) : (
            <div style={row({ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' })}>
              {shownTemplates.map((t) => (
                <Card
                  key={t.template_id}
                  testId={`template-${t.template_id}`}
                  style={{ width: narrow ? '100%' : 260, flexGrow: 1, gap: 8 }}
                  onClick={() => {
                    setName(t.name)
                    setPrompt(t.description)
                    setCreating(true)
                    setTab('automations')
                  }}
                >
                  <T weight={500}>{t.name}</T>
                  <T size={12.5} color={C.tertiary} style={{ lineClamp: 2 }}>{t.description}</T>
                  <div style={{ ...row({ gap: 6, flexWrap: 'wrap' }), paddingTop: 2 }}>
                    {t.triggers.map(describeTrigger).filter(Boolean).map((x) => <Badge key={x} icon="clock" label={x} />)}
                    {t.required_integrations.map((x) => <Badge key={x} label={x} />)}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </Page>
  )
}

/* ───────────────────────────── Security ───────────────────────────── */

export function Stat({ label, value, testId, hint }: { label: string; value: number | string; testId: string; hint?: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 0, minWidth: 128, gap: 4, paddingTop: 12, paddingBottom: 12 }}>
      <T size={12.5} color={C.tertiary}>{label}</T>
      <T testId={testId} size={24} weight={600} style={{ lineHeight: 30 }}>{String(value)}</T>
      {hint && <T size={12} color={C.ghost}>{hint}</T>}
    </Card>
  )
}

export function prStats(sessions: Session[]) {
  const prs = sessions.flatMap((s) => s.live?.prs ?? [])
  const by = (st: string) => prs.filter((p) => (p.state ?? 'open').toLowerCase() === st).length
  return { total: prs.length, open: by('open'), merged: by('merged'), closed: by('closed') }
}

export function Table({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div testId={testId} style={{ ...col(), borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

export function TableRow({ children, onClick, testId, last }: { children: React.ReactNode; onClick?: () => void; testId?: string; last?: boolean }) {
  return (
    <div testId={testId} onClick={onClick} style={{ ...row({ gap: 10 }), minHeight: 42, paddingLeft: 14, paddingRight: 14, borderBottomWidth: last ? 0 : 1, borderColor: C.border, cursor: onClick ? 'pointer' : 'default', hover: onClick ? { backgroundColor: C.hover } : {} }}>
      {children}
    </div>
  )
}

export function SecurityView({ api, sessions, narrow }: { api: DevinApi | null; sessions: Session[]; narrow?: boolean }) {
  const secrets = useApiList<ApiSecret>(api?.listSecrets?.bind(api), [api])
  const s = prStats(sessions)
  const list = secrets.items ?? []
  return (
    <Page testId="view-security" narrow={narrow} title="Security" subtitle="Pull requests Devin opened, code scan findings, and the secrets it can use." actions={<Btn icon="external" label="Scans on web" onClick={() => openUrl(`${WEB}/security`)} />}>
      <div style={col({ gap: 8 })}>
        <div style={row({ gap: 10, flexWrap: 'wrap' })}>
          <Stat testId="stat-total" label="Pull requests" value={s.total} />
          <Stat testId="stat-open" label="Open" value={s.open} />
          <Stat testId="stat-merged" label="Merged" value={s.merged} />
          <Stat testId="stat-closed" label="Closed" value={s.closed} />
        </div>
        <T size={12} color={C.ghost}>{`Counted from the ${sessions.length} sessions loaded in the sidebar.`}</T>
      </div>
      <FindingsList api={api} />
      <div style={col({ gap: 10 })}>
        <SectionTitle title="Secrets" count={secrets.items?.length} hint="Names and notes only. Values never leave Devin." />
        {secrets.error && <Notice text={secrets.error} tone="error" />}
        {list.length > 0 ? (
          <Table testId="secret-list">
            {list.map((x, i) => (
              <TableRow key={x.secret_id} last={i === list.length - 1}>
                <Icon name="key" size={14} color={C.ghost} />
                <T mono size={12.5} style={{ flexShrink: 0 }}>{x.key}</T>
                <T size={12.5} color={C.tertiary} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{x.note ?? ''}</T>
                <Badge label={x.secret_type ?? 'secret'} />
              </TableRow>
            ))}
          </Table>
        ) : (
          <div testId="secret-list">{secrets.items && <EmptyState compact icon="key" title={api ? 'No secrets' : 'No API key'} body={api ? 'Secrets you add on app.devin.ai show up here.' : 'Connect a Devin API key to list secrets.'} />}</div>
        )}
      </div>
    </Page>
  )
}

/* ───────────────────────────── Review ───────────────────────────── */

export function ReviewView({ sessions, onReview, onOpenSession, narrow }: { sessions: Session[]; onReview: (prUrl: string) => void; onOpenSession: (id: string) => void; narrow?: boolean }) {
  const [url, setUrl] = useSticky('review.url', '')
  const [repo, setRepo] = useSticky('review.repo', 'all')
  const [state, setState] = useSticky<'open' | 'merged' | 'all'>('review.state', 'open')
  const prs = useMemo(
    () =>
      sessions.flatMap((s) =>
        (s.live?.prs ?? []).map((p) => {
          const m = p.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
          return { ...p, session: s, repo: m?.[1] ?? 'other', number: m?.[2] ?? '' }
        }),
      ),
    [sessions],
  )
  const repos = useMemo(() => [...new Set(prs.map((p) => p.repo))].slice(0, 8), [prs])
  const shown = prs.filter((p) => (repo === 'all' || p.repo === repo) && (state === 'all' || (p.state ?? 'open').toLowerCase() === state)).slice(0, 60)
  const valid = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)
  return (
    <Page testId="view-review" narrow={narrow} title="Review" subtitle="Pull requests from your Devin sessions. Paste any PR to have Devin review it.">
      <div style={{ ...col({ gap: 10 }), padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
        <div style={row({ gap: 8 })}>
          <IconTile icon="pr" size={32} />
          <div style={{ flexGrow: 1 }}>
            <Field testId="review-url" value={url} onChange={setUrl} placeholder="https://github.com/owner/repo/pull/123" />
          </div>
          <Btn testId="review-start" primary label="Review with Devin" disabled={!valid} onClick={() => valid && onReview(url.trim())} />
        </div>
      </div>
      <div style={col({ gap: 10 })}>
        <div style={row({ gap: 12, flexWrap: 'wrap' })}>
          <Pills testId="review-state" value={state} onChange={setState} items={[{ value: 'open', label: 'Open' }, { value: 'merged', label: 'Merged' }, { value: 'all', label: 'All' }]} />
          {repos.length > 1 && <div style={{ width: 1, height: 18, backgroundColor: C.border }} />}
          {repos.length > 1 && <Pills testId="review-repo" value={repo} onChange={setRepo} items={[{ value: 'all', label: 'All repos' }, ...repos.map((r) => ({ value: r, label: r.split('/')[1] ?? r }))]} />}
        </div>
        <div testId="review-list" style={col({ gap: 2 })}>
          {shown.length === 0 && <EmptyState compact icon="pr" title="No pull requests match" body="Pull requests Devin opens in your sessions show up here." />}
          {shown.map((p) => {
            const merged = (p.state ?? '').toLowerCase() === 'merged'
            return (
              <ListRow key={`${p.session.id}-${p.url}`} style={{ minHeight: 48 }}>
                <Icon name={merged ? 'merge' : 'pr'} size={15} color={merged ? C.purple : C.add} />
                <div style={{ ...col({ gap: 1, flexGrow: 1, minWidth: 0 }), cursor: 'pointer' }} onClick={() => onOpenSession(p.session.id)}>
                  <T size={13.5} weight={500} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.session.title}</T>
                  <T size={12} color={C.tertiary} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`${p.repo} #${p.number} · ${p.session.updated}`}</T>
                </div>
                <Badge label={merged ? 'Merged' : (p.state ?? 'open').replace(/^./, (m) => m.toUpperCase())} tone={merged ? 'purple' : (p.state ?? 'open') === 'open' ? 'green' : 'neutral'} />
                <IconButton icon="external" size={14} box={28} tip="Open on GitHub" onClick={() => openUrl(p.url)} />
                {!narrow && <Btn small label="Review" onClick={() => onReview(p.url)} />}
              </ListRow>
            )
          })}
        </div>
      </div>
    </Page>
  )
}

/* ───────────────────────────── Customize ───────────────────────────── */

export function CustomizeView({ api, tab, onTab, onUsePlaybook, narrow }: { api: DevinApi | null; tab: 'playbooks' | 'knowledge'; onTab: (t: 'playbooks' | 'knowledge') => void; onUsePlaybook: (pb: ApiPlaybook) => void; narrow?: boolean }) {
  const playbooks = useApiList<ApiPlaybook>(api?.listPlaybooks?.bind(api), [api])
  const notes = useApiList<ApiNote>(api?.listNotes ? () => api.listNotes!() : undefined, [api])
  const [q, setQ] = useSticky('custom.q', '')
  const [openId, setOpenId] = useSticky<string | null>('custom.open', null)
  const [creating, setCreating] = useSticky('custom.creating', false)
  const [title, setTitle] = useSticky('custom.title', '')
  const [macro, setMacro] = useSticky('custom.macro', '')
  const [body, setBody] = useSticky('custom.body', '')
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  const needle = q.trim().toLowerCase()

  const create = async () => {
    try {
      if (tab === 'playbooks') {
        const pb = await api!.createPlaybook!({ title: title.trim(), body, macro: macro.trim() ? (macro.startsWith('!') ? macro.trim() : `!${macro.trim()}`) : undefined })
        playbooks.setItems((xs) => [pb, ...(xs ?? [])])
        setNotice({ text: `Created playbook “${pb.title}”`, tone: 'ok' })
      } else {
        const n = await api!.createNote!({ name: title.trim(), trigger: macro.trim() || title.trim(), body })
        notes.setItems((xs) => [n, ...(xs ?? [])])
        setNotice({ text: `Created knowledge “${n.name}”`, tone: 'ok' })
      }
      setCreating(false)
      setTitle('')
      setMacro('')
      setBody('')
    } catch (e) {
      setNotice({ text: String((e as Error).message), tone: 'error' })
    }
  }
  const toggleNote = async (n: ApiNote, on: boolean) => {
    notes.setItems((xs) => (xs ?? []).map((x) => (x.note_id === n.note_id ? { ...x, is_enabled: on } : x)))
    try {
      await api?.setNoteEnabled?.(n, on)
      setNotice({ text: `${on ? 'Enabled' : 'Disabled'} “${n.name}”`, tone: 'ok' })
    } catch (e) {
      notes.setItems((xs) => (xs ?? []).map((x) => (x.note_id === n.note_id ? { ...x, is_enabled: !on } : x)))
      setNotice({ text: String((e as Error).message), tone: 'error' })
    }
  }

  const pbs = (playbooks.items ?? []).filter((p) => !needle || `${p.title} ${p.macro ?? ''}`.toLowerCase().includes(needle))
  const ns = (notes.items ?? []).filter((n) => !needle || `${n.name} ${n.trigger} ${n.folder_path}`.toLowerCase().includes(needle))
  const md = { width: '100%', minWidth: 0, fontFamily: SANS, fontSize: 13, lineHeight: 20, color: C.secondary } as const

  return (
    <Page
      testId="view-customize"
      narrow={narrow}
      title="Customize"
      subtitle="Playbooks and knowledge Devin uses in every session."
      actions={<Btn testId="customize-new" primary icon="plus" label={tab === 'playbooks' ? 'New playbook' : 'New knowledge'} disabled={!api} onClick={() => setCreating((v) => !v)} />}
    >
      <div style={col({ gap: 12 })}>
        <Tabs
          testId="customize-tab"
          value={tab}
          onChange={(t) => {
            onTab(t)
            setOpenId(null)
            setCreating(false)
          }}
          items={[
            { value: 'playbooks', label: 'Playbooks', count: playbooks.items?.length },
            { value: 'knowledge', label: 'Knowledge', count: notes.items?.length },
          ]}
        />
        <Field testId="customize-search" value={q} onChange={setQ} placeholder={`Search ${tab}`} />
      </div>
      {creating && (
        <FormCard
          testId="customize-form"
          title={tab === 'playbooks' ? 'New playbook' : 'New knowledge'}
          footer={
            <>
              <Btn label="Cancel" ghost onClick={() => setCreating(false)} />
              <Btn testId="customize-create" primary label="Create" disabled={!title.trim() || !body.trim()} onClick={create} />
            </>
          }
        >
          <div style={col({ gap: 6 })}>
            <Label>{tab === 'playbooks' ? 'Title' : 'Name'}</Label>
            <Field testId="customize-title" value={title} onChange={setTitle} placeholder={tab === 'playbooks' ? 'Release checklist' : 'Use pnpm, never npm'} />
          </div>
          <div style={col({ gap: 6 })}>
            <Label>{tab === 'playbooks' ? 'Macro (optional)' : 'Trigger'}</Label>
            <Field testId="customize-macro" value={macro} onChange={setMacro} placeholder={tab === 'playbooks' ? '!release' : 'When should Devin use this?'} />
          </div>
          <div style={col({ gap: 6 })}>
            <Label>{tab === 'playbooks' ? 'Steps' : 'Knowledge'}</Label>
            <Field testId="customize-body" value={body} onChange={setBody} placeholder={tab === 'playbooks' ? 'Steps, in Markdown' : 'What Devin should know'} multiline />
          </div>
        </FormCard>
      )}
      {notice && <Notice text={notice.text} tone={notice.tone} />}
      <div testId="customize-list" style={col({ gap: 8 })}>
        {tab === 'playbooks'
          ? playbooks.items === null
            ? <Empty text="Loading playbooks…" />
            : pbs.length === 0
              ? <EmptyState icon="library" title={api ? 'No playbooks match' : 'No API key'} body={api ? 'Try another search, or create a playbook.' : 'Connect a Devin API key to list playbooks.'} />
              : pbs.map((p) => {
                  const open = openId === p.playbook_id
                  return (
                    <Card key={p.playbook_id} testId={`playbook-${p.playbook_id}`} style={{ padding: 0, gap: 0, overflow: 'hidden', borderColor: open ? C.borderStrong : C.border }}>
                      <div style={{ ...row({ gap: 12 }), minHeight: 50, paddingLeft: 12, paddingRight: 14, cursor: 'pointer', hover: { backgroundColor: C.hover } }} onClick={() => setOpenId(open ? null : p.playbook_id)}>
                        <IconTile icon="library" />
                        <T weight={500} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.title}</T>
                        {p.macro && <Badge mono label={p.macro} tone="blue" />}
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={C.ghost} />
                      </div>
                      {open && (
                        <div style={{ ...col({ gap: 12 }), paddingLeft: 52, paddingRight: 16, paddingTop: 4, paddingBottom: 14 }}>
                          <markdown testId={`playbook-body-${p.playbook_id}`} source={p.body.slice(0, 4000)} theme={nativeTheme()} style={md} />
                          <div style={row({ gap: 8 })}>
                            <Btn testId={`playbook-use-${p.playbook_id}`} small primary icon="plus" label="Use in new session" onClick={() => onUsePlaybook(p)} />
                            <Btn small ghost label="Open on web" icon="external" onClick={() => openUrl(`${WEB}/playbooks/${p.playbook_id}`)} />
                          </div>
                        </div>
                      )}
                    </Card>
                  )
                })
          : notes.items === null
            ? <Empty text="Loading knowledge…" />
            : ns.length === 0
              ? <EmptyState icon="book" title={api ? 'No knowledge matches' : 'No API key'} body={api ? 'Try another search, or add knowledge.' : 'Connect a Devin API key to list knowledge.'} />
              : ns.slice(0, 200).map((n) => {
                  const open = openId === n.note_id
                  return (
                    <Card key={n.note_id} testId={`note-${n.note_id}`} style={{ padding: 0, gap: 0, overflow: 'hidden', borderColor: open ? C.borderStrong : C.border }}>
                      <div style={{ ...row({ gap: 12 }), minHeight: 56, paddingLeft: 12, paddingRight: 14 }}>
                        <div style={{ ...row({ gap: 12, flexGrow: 1, minWidth: 0 }), cursor: 'pointer' }} onClick={() => setOpenId(open ? null : n.note_id)}>
                          <IconTile icon="book" color={n.is_enabled ? C.tertiary : C.ghost} />
                          <div style={col({ gap: 1, flexGrow: 1, minWidth: 0 })}>
                            <T weight={500} color={n.is_enabled ? C.text : C.tertiary} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.name}</T>
                            <T size={12} color={C.tertiary} style={{ whiteSpace: open ? 'normal' : 'nowrap', textOverflow: 'ellipsis' }}>{`${n.folder_path ? `${n.folder_path} · ` : ''}Trigger: ${n.trigger}`}</T>
                          </div>
                        </div>
                        {n.pinned_repo && !narrow && <Badge icon="folder" label={n.pinned_repo} />}
                        <Toggle testId={`note-toggle-${n.note_id}`} on={n.is_enabled} onChange={(v) => toggleNote(n, v)} />
                      </div>
                      {open && (
                        <div style={{ paddingLeft: 52, paddingRight: 16, paddingBottom: 14 }}>
                          <markdown testId={`note-body-${n.note_id}`} source={n.body.slice(0, 4000)} theme={nativeTheme()} style={md} />
                        </div>
                      )}
                    </Card>
                  )
                })}
      </div>
    </Page>
  )
}

/* ───────────────────────────── Notifications ───────────────────────────── */

export type Notification = { id: string; session: Session; title: string; detail: string; unread: boolean; alert: boolean }

export function notificationsFor(sessions: Session[], readAt: number, now = Date.now() / 1000): Notification[] {
  return sessions
    .filter((s) => s.live && now - s.live.updatedAt < 7 * 86400 && (s.status === 'blocked' || s.status === 'finished' || (s.live.prs.length > 0 && s.status !== 'running')))
    .sort((a, b) => b.live!.updatedAt - a.live!.updatedAt)
    .slice(0, 80)
    .map((s) => {
      const approval = s.live!.statusDetail === 'waiting_for_approval'
      const open = s.live!.prs.find((p) => (p.state ?? 'open') === 'open')
      return {
        id: s.id,
        session: s,
        title: s.title,
        detail: approval ? 'Approval required' : s.status === 'blocked' ? 'Waiting for your reply' : open ? 'Review PR' : 'Finished',
        unread: s.live!.updatedAt > readAt,
        alert: approval || s.status === 'blocked',
      }
    })
}

export function NotificationsView({ items, onOpen, onMarkAll, narrow }: { items: Notification[]; onOpen: (id: string) => void; onMarkAll: () => void; narrow?: boolean }) {
  const [tab, setTab] = useSticky<'all' | 'unread'>('notif.tab', 'all')
  const unread = items.filter((n) => n.unread).length
  const shown = tab === 'unread' ? items.filter((n) => n.unread) : items
  return (
    <Page testId="view-notifications" narrow={narrow} title="Notifications" subtitle="Sessions that need you or just finished." actions={<Btn testId="notifications-read" icon="check" label="Mark all read" disabled={unread === 0} onClick={onMarkAll} />}>
      <Tabs testId="notifications-tab" value={tab} onChange={setTab} items={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: unread }]} />
      <div testId="notification-list" style={col({ gap: 2 })}>
        {shown.length === 0 && <EmptyState icon="inbox" title={tab === 'unread' ? 'You’re all caught up' : 'Nothing yet'} body="Sessions that wait for you, open a PR or finish show up here." />}
        {shown.map((n) => {
          const review = n.detail === 'Review PR'
          return (
            <ListRow key={n.id} testId={`notification-${n.id}`} onClick={() => onOpen(n.id)} style={{ minHeight: 54, gap: 12 }}>
              <IconTile icon={n.alert ? 'circleAlert' : review ? 'pr' : 'circleCheck'} color={n.alert ? C.orange : review ? C.add : C.tertiary} bg={n.alert ? C.orangeSoft : review ? C.greenSoft : undefined} size={30} />
              <div style={col({ flexGrow: 1, minWidth: 0, gap: 1 })}>
                <T size={13.5} weight={n.unread ? 600 : 400} color={n.unread ? C.text : C.secondary} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.title}</T>
                <T size={12.5} color={n.alert ? C.orange : C.tertiary}>{n.detail}</T>
              </div>
              <T size={12} color={C.ghost} style={{ flexShrink: 0 }}>{n.session.updated}</T>
              <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: n.unread ? C.blue : CLEAR, flexShrink: 0 }} />
            </ListRow>
          )
        })}
      </div>
    </Page>
  )
}

/* ───────────────────────────── Settings ───────────────────────────── */

export type SettingsPage = 'preferences' | 'shortcuts' | 'api' | 'web'
type NavItem = { id: string; label: string; icon: IconName; page?: SettingsPage; go?: [View, string?]; web?: string }

const SETTINGS_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Personal',
    items: [
      { id: 'preferences', label: 'Preferences', icon: 'sliders', page: 'preferences' },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'list', page: 'shortcuts' },
      { id: 'notifications', label: 'Notifications', icon: 'bell', go: ['notifications'] },
      { id: 'connections', label: 'Connections', icon: 'link', web: '/settings/connections' },
    ],
  },
  {
    section: 'Organization',
    items: [
      { id: 'api', label: 'Devin API', icon: 'key', page: 'api' },
      { id: 'schedules', label: 'Schedules', icon: 'clock', go: ['automations'] },
      { id: 'knowledge', label: 'Knowledge', icon: 'book', go: ['customize', 'knowledge'] },
      { id: 'playbooks', label: 'Playbooks', icon: 'library', go: ['customize', 'playbooks'] },
      { id: 'secrets', label: 'Secrets', icon: 'shield', go: ['security'] },
      { id: 'review', label: 'Review', icon: 'pr', go: ['review'] },
      { id: 'environment', label: 'Environment', icon: 'laptop', web: '/settings/environment' },
      { id: 'repositories', label: 'Repositories', icon: 'gitBranch', web: '/settings/repositories' },
      { id: 'deepwiki', label: 'DeepWiki', icon: 'library', web: '/wiki' },
      { id: 'desktop', label: 'Devin Desktop', icon: 'monitor', web: '/settings/devin-desktop' },
      { id: 'membership', label: 'Membership', icon: 'shapes', web: '/settings/membership' },
    ],
  },
]

export const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Search sessions'],
  ['⇧⌘O', 'New session'],
  ['↑ / ↓', 'Move through sessions'],
  ['Enter', 'Send message'],
  ['⇧Enter', 'New line in the composer'],
  ['Esc', 'Close menus, clear search, leave a page'],
  ['⇧⌘L', 'Toggle light / dark'],
  ['⌘,', 'Settings (window mode; in Ghostty use the gear, ⌘, opens Ghostty config)'],
  ['⌘B', 'Show / hide sidebar'],
  ['⌘.', 'Show / hide the right panel'],
  ['⌘+ / ⌘− / ⌘0', 'Zoom in / out / reset (also ⌃+ / ⌃− / ⌃0)'],
  ['Ctrl-C', 'Quit and restore the terminal'],
]

function Group({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div testId={testId} style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

function SettingRow({ label, hint, children, last }: { label: string; hint?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ ...row({ gap: 16 }), minHeight: 56, paddingLeft: 16, paddingRight: 14, paddingTop: 10, paddingBottom: 10, borderBottomWidth: last ? 0 : 1, borderColor: C.border, flexWrap: 'wrap' }}>
      <div style={col({ flexGrow: 1, flexBasis: 0, minWidth: 200, gap: 2 })}>
        <T weight={500}>{label}</T>
        {hint && <T size={12.5} color={C.tertiary}>{hint}</T>}
      </div>
      {children}
    </div>
  )
}

function ZoomStepper({ zoom, onZoom }: { zoom: number; onZoom?: (z: number) => void }) {
  const seg = (testId: string, label: string, onClick: () => void, disabled: boolean, wide?: boolean) => (
    <Button
      testId={testId}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{ ...row({ justifyContent: 'center' }), width: wide ? 60 : 30, height: 28, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, borderLeftWidth: wide ? 1 : 0, borderRightWidth: wide ? 1 : 0, borderColor: C.border, hover: disabled ? {} : { backgroundColor: C.hover }, active: disabled ? {} : { backgroundColor: C.selected } }}
    >
      <text style={{ fontFamily: SANS, fontSize: wide ? 12.5 : 15, fontWeight: 500, color: C.text, pointerEvents: 'none' }}>{label}</text>
    </Button>
  )
  return (
    <div style={{ ...row(), borderRadius: 8, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.raised, overflow: 'hidden', flexShrink: 0 }}>
      {seg('zoom-out', '−', () => onZoom?.(stepZoom(zoom, -1)), zoom <= 0.75)}
      {seg('zoom-reset', `${Math.round(zoom * 100)}%`, () => onZoom?.(1), false, true)}
      {seg('zoom-in', '+', () => onZoom?.(stepZoom(zoom, 1)), zoom >= 2)}
    </div>
  )
}

function Keys({ combo }: { combo: string }) {
  const parts = combo.split(' / ')
  return (
    <div style={row({ gap: 4 })}>
      {parts.map((k, i) => (
        <React.Fragment key={k}>
          {i > 0 && <T size={12} color={C.ghost}>/</T>}
          <Kbd keys={k} />
        </React.Fragment>
      ))}
    </div>
  )
}

export type SettingsProps = {
  zoom?: number
  onZoom?: (z: number) => void
  instance?: number
  api: DevinApi | null
  orgId: string | null
  baseUrl: string
  keyHint: string | null
  themeName: 'dark' | 'light'
  onTheme: (t: 'dark' | 'light') => void
  mode: string
  modes: { value: string; label: string }[]
  onMode: (m: string) => void
  repo: string
  repos: string[]
  onRepo: (r: string) => void
  onNavigate: (v: View, tab?: string) => void
  onResetTitles: () => void
  renamedCount: number
  narrow?: boolean
  initialPage?: string
  keySource?: string | null
  onSaveKey?: (c: { apiKey: string; orgId: string }) => Promise<string>
  onRemoveKey?: () => Promise<void>
  verifyKey?: (c: { apiKey: string; orgId: string; baseUrl: string }) => Promise<unknown>
}

export function SettingsView(p: SettingsProps) {
  // Each open of Settings gets its own slot, so the theme toggle's remount keeps the page you were on.
  const [page, setPage] = useSticky<string>(`settings-page-${p.instance ?? 0}`, p.initialPage ?? 'preferences')
  const [q, setQ] = useSticky('settings.q', '')
  const [check, setCheck] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [orgDraft, setOrgDraft] = useState(p.orgId ?? '')
  const [reveal, setReveal] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [keyMsg, setKeyMsg] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  const needle = q.trim().toLowerCase()
  const click = (it: NavItem) => {
    if (it.go) return p.onNavigate(it.go[0], it.go[1])
    if (it.web) openUrl(`${WEB}${it.web}`)
    setPage(it.id)
  }
  const current = SETTINGS_NAV.flatMap((s) => s.items).find((i) => i.id === page)!
  const testConnection = async () => {
    if (!p.api) return setCheck({ text: 'No API key configured', tone: 'error' })
    setCheck({ text: 'Checking…' })
    const t0 = Date.now()
    try {
      const r = await p.api.listSessions(1)
      setCheck({ text: `Connected · ${r.items.length ? 'sessions readable' : 'no sessions'} · ${Date.now() - t0} ms`, tone: 'ok' })
    } catch (e) {
      setCheck({ text: String((e as Error).message), tone: 'error' })
    }
  }

  const nav = (
    <div style={{ ...col({ gap: 1 }), width: p.narrow ? '100%' : 232, flexShrink: 0, paddingTop: 16, paddingLeft: 10, paddingRight: 10, paddingBottom: 16, borderRightWidth: p.narrow ? 0 : 1, borderColor: C.border, overflowY: 'scroll' }}>
      <div style={{ paddingLeft: 2, paddingRight: 2, paddingBottom: 8 }}>
        <Field testId="settings-search" value={q} onChange={setQ} placeholder="Search settings" />
      </div>
      {SETTINGS_NAV.map((s) => {
        const items = s.items.filter((i) => !needle || i.label.toLowerCase().includes(needle))
        if (!items.length) return null
        return (
          <React.Fragment key={s.section}>
            <div style={{ paddingLeft: 10, paddingTop: 12, paddingBottom: 4 }}>
              <T size={11.5} color={C.ghost} weight={500}>{s.section}</T>
            </div>
            {items.map((it) => {
              const active = page === it.id
              return (
                <div key={it.id} testId={`settings-nav-${it.id}`} onClick={() => click(it)} style={{ ...row({ gap: 10 }), height: 30, paddingLeft: 10, paddingRight: 8, borderRadius: 7, cursor: 'pointer', backgroundColor: active ? C.selected : CLEAR, hover: { backgroundColor: active ? C.selected : C.hover } }}>
                  <Icon name={it.icon} size={15} color={active ? C.text : C.tertiary} />
                  <text style={{ fontFamily: SANS, fontSize: 13.5, color: active ? C.text : C.secondary, fontWeight: active ? 500 : 400, flexGrow: 1, pointerEvents: 'none' }}>{it.label}</text>
                  {(it.web || it.go) && <Icon name={it.web ? 'external' : 'chevronRight'} size={13} color={C.ghost} />}
                </div>
              )
            })}
          </React.Fragment>
        )
      })}
    </div>
  )

  let body: React.ReactNode
  if (page === 'preferences') {
    body = (
      <Page testId="settings-preferences" narrow={p.narrow} title="Preferences" subtitle="Saved to ~/.config/devin-tui/prefs.json on this machine.">
        <Group>
          <SettingRow label="Appearance" hint="Defaults to your Ghostty theme. Also ⇧⌘L.">
            <Segmented testId="pref-theme" value={p.themeName} onChange={p.onTheme} items={[{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }]} />
          </SettingRow>
          <SettingRow label="Zoom" hint="Scales the whole app. ⌘+ / ⌘− / ⌘0 or ⌃+ / ⌃− / ⌃0; in Ghostty the app follows the terminal's font size." last>
            <ZoomStepper zoom={p.zoom ?? 1} onZoom={p.onZoom} />
          </SettingRow>
        </Group>
        <Group>
          <SettingRow label="Default agent" hint="Sent as devin_mode when you start a session.">
            <Segmented small testId="pref-mode" value={p.mode} onChange={p.onMode} items={p.modes} />
          </SettingRow>
          <SettingRow label="Default repository" hint="Attached to new sessions as repos." last>
            <Pills testId="pref-repo" value={p.repo} onChange={p.onRepo} items={p.repos.slice(0, 6).map((r) => ({ value: r, label: r.split('/')[1] ?? r }))} />
          </SettingRow>
        </Group>
        <Group>
          <SettingRow label="Renamed sessions" hint={`${p.renamedCount} local title override${p.renamedCount === 1 ? '' : 's'}. The Devin API has no rename, so names stay on this machine.`} last>
            <Btn testId="pref-reset-titles" small label="Reset names" disabled={p.renamedCount === 0} onClick={p.onResetTitles} />
          </SettingRow>
        </Group>
      </Page>
    )
  } else if (page === 'shortcuts') {
    body = (
      <Page testId="settings-shortcuts" narrow={p.narrow} title="Keyboard shortcuts" subtitle="Ghostty keeps some keys for itself; unbind ⌘K and ⌘N there to let the app have them.">
        <Group>
          {SHORTCUTS.map(([k, label], i) => (
            <div key={k} style={{ ...row({ gap: 12 }), minHeight: 42, paddingLeft: 16, paddingRight: 14, borderBottomWidth: i === SHORTCUTS.length - 1 ? 0 : 1, borderColor: C.border }}>
              <T style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{label}</T>
              <Keys combo={k} />
            </div>
          ))}
        </Group>
      </Page>
    )
  } else if (page === 'api') {
    const source = p.keySource
    const sourceLabel = source === 'env' ? 'Environment variable (DEVIN_API_KEY)' : source === 'keychain' ? 'macOS Keychain' : source === 'file' ? '~/.config/devin-tui/config.json (only you can read it)' : 'Not configured'
    const draft = { apiKey: keyDraft.trim(), orgId: orgDraft.trim() }
    const draftOk = draft.apiKey.length >= 8 && draft.orgId.startsWith('org-')
    const verify = p.verifyKey ?? (async (c: { apiKey: string; orgId: string; baseUrl: string }) => new DevinClient(c).listSessions(1))
    const runKey = async (save: boolean) => {
      setKeyBusy(true)
      setKeyMsg({ text: save ? 'Checking the key, then saving…' : 'Checking…' })
      try {
        await verify({ ...draft, baseUrl: p.baseUrl })
        if (!save || !p.onSaveKey) return setKeyMsg({ text: 'This key works for that organization', tone: 'ok' })
        const where = await p.onSaveKey(draft)
        setKeyDraft('')
        setKeyMsg({ text: `Saved to ${where === 'keychain' ? 'the macOS Keychain' : 'a private config file'}`, tone: 'ok' })
      } catch (e) {
        setKeyMsg({ text: `That key didn't work: ${(e as Error).message}`, tone: 'error' })
      } finally {
        setKeyBusy(false)
      }
    }
    const info = (label: string, value: React.ReactNode, last?: boolean) => (
      <div style={{ ...row({ gap: 16 }), minHeight: 42, paddingLeft: 16, paddingRight: 16, borderBottomWidth: last ? 0 : 1, borderColor: C.border }}>
        <T size={13} color={C.tertiary} style={{ width: 110, flexShrink: 0 }}>{label}</T>
        <div style={{ ...row({ gap: 8 }), flexGrow: 1, minWidth: 0 }}>{value}</div>
      </div>
    )
    body = (
      <Page testId="settings-api" narrow={p.narrow} title="Devin API" subtitle="devin-tui talks to the Devin v3 API with a personal access token. Save one here instead of exporting environment variables.">
        <Group>
          <div style={{ ...row({ gap: 12 }), minHeight: 56, paddingLeft: 14, paddingRight: 14, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.cardHead }}>
            <IconTile icon="key" size={30} color={p.api ? C.add : C.orange} bg={p.api ? C.greenSoft : C.orangeSoft} />
            <div style={col({ gap: 1, flexGrow: 1, minWidth: 0 })}>
              <T weight={600}>Connection</T>
              <T size={12.5} color={C.tertiary}>{p.api ? 'Sessions, automations and settings come from your organization.' : 'Running on scripted demo data.'}</T>
            </div>
            <Badge big tone={p.api ? 'green' : 'orange'} status={p.api ? 'finished' : 'blocked'} label={p.api ? 'Live' : 'Demo data (no key)'} testId="api-status" />
          </div>
          {info('Organization', <T mono size={12.5} color={C.secondary}>{p.orgId ?? '—'}</T>)}
          {info('Endpoint', <T mono size={12.5} color={C.secondary}>{`${p.baseUrl}/v3`}</T>)}
          {info('Token', <T testId="api-key-hint" mono size={12.5} color={C.secondary}>{p.keyHint ?? '—'}</T>)}
          {info('Stored in', <T testId="api-key-source" size={13} color={C.secondary}>{sourceLabel}</T>, true)}
        </Group>
        <div style={row({ gap: 8, flexWrap: 'wrap' })}>
          <Btn testId="api-test" icon="zap" label="Test connection" onClick={testConnection} />
          <Btn ghost label="Create a token on web" icon="external" onClick={() => openUrl(`${WEB}/settings/api-keys`)} />
          <Btn ghost label="API docs" icon="external" onClick={() => openUrl('https://docs.devin.ai/api-reference/overview')} />
        </div>
        {check && <Notice text={check.text} tone={check.tone} />}
        <FormCard
          testId="api-key-form"
          title={source ? 'Replace API key' : 'Add an API key'}
          footer={
            <>
              {p.onRemoveKey && (source === 'keychain' || source === 'file') && (
                <Btn
                  testId="api-key-remove"
                  danger
                  ghost={!confirmRemove}
                  label={confirmRemove ? 'Click again to remove' : 'Remove saved key'}
                  onClick={() => {
                    if (!confirmRemove) return setConfirmRemove(true)
                    setConfirmRemove(false)
                    p.onRemoveKey?.().catch((e: Error) => setKeyMsg({ text: e.message, tone: 'error' }))
                  }}
                />
              )}
              <div style={{ flexGrow: 1 }} />
              <Btn testId="api-key-verify" label="Test this key" disabled={!draftOk || keyBusy} onClick={() => runKey(false)} />
              <Btn testId="api-key-save" primary label={keyBusy ? 'Saving…' : 'Save key'} disabled={!draftOk || keyBusy || !p.onSaveKey} onClick={() => runKey(true)} />
            </>
          }
        >
          {source === 'env' && <Notice text="DEVIN_API_KEY is set in this shell and overrides a saved key. Unset it to use the saved one." />}
          <div style={col({ gap: 6 })}>
            <Label>Organization ID</Label>
            <Field testId="api-org-input" value={orgDraft} onChange={setOrgDraft} placeholder="org-…" mono />
          </div>
          <div style={col({ gap: 6 })}>
            <Label>Personal access token</Label>
            <div style={row({ gap: 6 })}>
              <div style={{ flexGrow: 1 }}>
                <SecretField testId="api-key-input" value={keyDraft} onChange={setKeyDraft} placeholder="Paste your token" reveal={reveal} />
              </div>
              <IconButton testId="api-key-reveal" icon={reveal ? 'eyeOff' : 'eye'} size={15} box={32} tip={reveal ? 'Hide token' : 'Show token'} onClick={() => setReveal((r) => !r)} />
            </div>
          </div>
          {keyMsg && <Notice text={keyMsg.text} tone={keyMsg.tone} />}
          <T size={12} color={C.ghost}>The key is checked against the API before it's saved. On macOS it goes to the Keychain (service “devin-tui”); elsewhere to ~/.config/devin-tui/config.json with 0600 permissions. Environment variables still take priority.</T>
        </FormCard>
      </Page>
    )
  } else {
    body = (
      <Page testId="settings-web" narrow={p.narrow} title={current.label}>
        <EmptyState icon="external" title="Opened in your browser" body="This page isn't in the public Devin API, so it opened on app.devin.ai." action={<Btn primary icon="external" label="Open again" onClick={() => openUrl(`${WEB}${current.web ?? ''}`)} />} />
      </Page>
    )
  }
  return (
    <div testId="view-settings" style={{ ...(p.narrow ? col() : row({ alignItems: 'stretch' })), flexGrow: 1, minHeight: 0 }}>
      {(!p.narrow || page === 'menu') && nav}
      {p.narrow ? (
        <div style={{ ...col(), flexGrow: 1, minHeight: 0 }}>
          <div style={{ ...row({ gap: 4 }), paddingLeft: 14, paddingTop: 10 }}>
            {SETTINGS_NAV[0]!.items.concat(SETTINGS_NAV[1]!.items.slice(0, 1)).filter((i) => i.page).map((i) => (
              <div key={i.id} testId={`settings-nav-${i.id}`} onClick={() => setPage(i.id)} style={{ ...row({ gap: 6 }), height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: 'pointer', backgroundColor: page === i.id ? C.selected : CLEAR, hover: { backgroundColor: page === i.id ? C.selected : C.hover } }}>
                <Icon name={i.icon} size={13} color={page === i.id ? C.text : C.tertiary} />
                <T size={12.5} weight={500} color={page === i.id ? C.text : C.tertiary}>{i.label}</T>
              </div>
            ))}
          </div>
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  )
}
