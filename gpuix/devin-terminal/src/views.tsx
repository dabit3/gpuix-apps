// Full-page views behind the sidebar nav, Settings and the bell. Everything here talks to the real Devin v3 API when one is configured.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Select, SelectContent, SelectItem, SelectTrigger, type StyleDesc } from '@gpuix/react'
import { Icon, type IconName } from './icons'
import { C } from './theme'
import { DevinClient, describeTrigger, SCHEDULE_PRESETS, timeAgo, type ApiAutomation, type ApiNote, type ApiPlaybook, type ApiSecret, type ApiTemplate, type DevinApi } from './api'
import type { Session } from './data'

export type View = 'home' | 'automations' | 'security' | 'review' | 'customize' | 'settings' | 'notifications'

export const SANS = 'Inter'
const MONO = 'Menlo'
const CLEAR = '#00000000'
export const WEB = 'https://app.devin.ai'
export const row = (extra: StyleDesc = {}): StyleDesc => ({ display: 'flex', flexDirection: 'row', alignItems: 'center', ...extra })
export const col = (extra: StyleDesc = {}): StyleDesc => ({ display: 'flex', flexDirection: 'column', ...extra })

export function openUrl(url: string) {
  if (!url || typeof Bun === 'undefined' || process.env.NODE_ENV === 'test') return
  try {
    Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}

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

export function T({ children, size = 13.5, color, weight, mono, testId, style }: { children: React.ReactNode; size?: number; color?: string; weight?: number; mono?: boolean; testId?: string; style?: StyleDesc }) {
  return (
    <text testId={testId} style={{ fontFamily: mono ? MONO : SANS, fontSize: size, color: color ?? C.text, fontWeight: weight, lineHeight: Math.round(size * 1.45), ...style }}>
      {children}
    </text>
  )
}

export function Btn({ label, onClick, testId, primary, icon, disabled, small, danger }: { label: string; onClick?: () => void; testId?: string; primary?: boolean; icon?: IconName; disabled?: boolean; small?: boolean; danger?: boolean }) {
  const bg = primary ? C.sendBg : CLEAR
  const fg = primary ? C.sendFg : danger ? C.del : C.text
  return (
    <Button
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{ ...row({ gap: 6, justifyContent: 'center' }), height: small ? 26 : 32, paddingLeft: small ? 9 : 12, paddingRight: small ? 9 : 12, borderRadius: 8, borderWidth: primary ? 0 : 1, borderColor: C.border, backgroundColor: bg, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer', flexShrink: 0, hover: { backgroundColor: primary ? bg : C.hover } }}
    >
      {icon && <Icon name={icon} size={13} color={fg} />}
      <text style={{ fontFamily: SANS, fontSize: small ? 12.5 : 13, color: fg, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</text>
    </Button>
  )
}

export function Pills<V extends string>({ items, value, onChange, testId }: { items: { value: V; label: string; count?: number }[]; value: V; onChange: (v: V) => void; testId: string }) {
  return (
    <div style={row({ gap: 4, flexWrap: 'wrap' })}>
      {items.map((it) => (
        <div
          key={it.value}
          testId={`${testId}-${it.value}`}
          onClick={() => onChange(it.value)}
          style={{ ...row({ gap: 6 }), height: 28, paddingLeft: 11, paddingRight: 11, borderRadius: 14, cursor: 'pointer', backgroundColor: value === it.value ? C.selected : CLEAR, hover: { backgroundColor: C.hover } }}
        >
          <text style={{ fontFamily: SANS, fontSize: 13, color: value === it.value ? C.text : C.tertiary, fontWeight: 500, whiteSpace: 'nowrap' }}>{it.label}</text>
          {it.count !== undefined && <text style={{ fontFamily: SANS, fontSize: 12, color: C.ghost }}>{String(it.count)}</text>}
        </div>
      ))}
    </div>
  )
}

export function Field({ value, onChange, placeholder, testId, multiline, mono }: { value: string; onChange: (v: string) => void; placeholder: string; testId: string; multiline?: boolean; mono?: boolean }) {
  const style: StyleDesc = { width: '100%', fontSize: 13.5, color: C.text, backgroundColor: C.card, fontFamily: mono ? MONO : SANS, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingLeft: 10, paddingRight: 10 }
  const theme = { caret: C.text, textMuted: C.ghost }
  return multiline ? (
    <textarea testId={testId} value={value} placeholder={placeholder} minRows={3} maxRows={8} onChange={(e) => onChange(e.value ?? '')} style={{ ...style, paddingTop: 8, paddingBottom: 8 }} theme={theme} />
  ) : (
    <input testId={testId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.value ?? '')} style={{ ...style, height: 32 }} theme={theme} />
  )
}

export function SecretField({ value, onChange, placeholder, testId, reveal }: { value: string; onChange: (v: string) => void; placeholder: string; testId: string; reveal: boolean }) {
  const masked = !reveal && value.length > 0
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        testId={testId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.value ?? '')}
        style={{ width: '100%', height: 32, fontSize: 13.5, color: masked ? C.card : C.text, backgroundColor: C.card, fontFamily: MONO, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingLeft: 10, paddingRight: 10 }}
        theme={{ caret: C.text, textMuted: C.ghost }}
      />
      {masked && (
        <div style={{ position: 'absolute', left: 11, top: 0, bottom: 0, ...row(), pointerEvents: 'none' }}>
          <T testId={`${testId}-mask`} mono size={13} color={C.text}>{'•'.repeat(Math.min(value.length, 40))}</T>
        </div>
      )}
    </div>
  )
}

export function Toggle({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <Button testId={testId} onClick={() => onChange(!on)} style={{ ...row({ justifyContent: on ? 'flex-end' : 'flex-start' }), width: 32, height: 18, borderRadius: 9, padding: 2, cursor: 'pointer', backgroundColor: on ? C.add : C.borderStrong, flexShrink: 0 }}>
      <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff', pointerEvents: 'none' }} />
    </Button>
  )
}

function Card({ children, testId, onClick, style }: { children: React.ReactNode; testId?: string; onClick?: () => void; style?: StyleDesc }) {
  return (
    <div testId={testId} onClick={onClick} style={{ ...col({ gap: 6 }), padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, cursor: onClick ? 'pointer' : 'default', hover: onClick ? { borderColor: C.borderStrong } : {}, ...style }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: C.border, flexShrink: 0 }} />
}

export function Page({ title, subtitle, actions, children, testId, narrow }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; testId: string; narrow?: boolean }) {
  return (
    <div testId={testId} style={{ ...col(), flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <div style={{ ...col({ gap: 18 }), width: '100%', maxWidth: 900, alignSelf: 'center', paddingLeft: narrow ? 16 : 36, paddingRight: narrow ? 16 : 36, paddingTop: 28, paddingBottom: 40 }}>
        <div style={row({ gap: 12, alignItems: 'flex-start' })}>
          <div style={col({ gap: 3, flexGrow: 1, minWidth: 0 })}>
            <T size={22} weight={600}>{title}</T>
            {subtitle && <T size={13.5} color={C.tertiary}>{subtitle}</T>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), paddingTop: 28, paddingBottom: 28 }}>
      <T color={C.ghost}>{text}</T>
    </div>
  )
}

export function Notice({ text, tone }: { text: string; tone?: 'error' | 'ok' }) {
  return <T testId="notice" size={12.5} color={tone === 'error' ? C.del : tone === 'ok' ? C.add : C.tertiary}>{text}</T>
}

/** Loads a list from an optional API method; `null` api → [] with a hint. */
function useApiList<T>(load: (() => Promise<T[]>) | undefined, deps: unknown[] = []) {
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

/* ───────────── Action menu (headless Select used as a popup menu) ───────────── */

export function menuStyle(): StyleDesc {
  return {
    minWidth: 220,
    padding: 4,
    backgroundColor: C.menu,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 12,
    boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: C.name === 'light' ? '#0000001f' : '#00000080' },
  }
}

export type MenuAction = { id: string; label: string; icon?: IconName; hint?: string; danger?: boolean; header?: boolean; run?: () => void }

export function ActionMenu({ items, testId, side = 'bottom', children, triggerStyle }: { items: MenuAction[]; testId: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactNode; triggerStyle?: StyleDesc }) {
  const actionable = items.filter((i) => !i.header)
  return (
    <Select items={actionable.map((i) => ({ value: i.id, label: i.label }))} value="" onValueChange={(v) => actionable.find((i) => i.id === v)?.run?.()} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId={testId}
          style={(s) => ({ ...row({ gap: 6, justifyContent: 'center' }), minWidth: 28, height: 28, paddingLeft: 6, paddingRight: 6, borderRadius: 8, cursor: 'pointer', backgroundColor: s.open ? C.hover : CLEAR, hover: { backgroundColor: C.hover }, ...triggerStyle })}
        >
          {children}
        </SelectTrigger>
        <SelectContent side={side} sideOffset={6} style={menuStyle()}>
          {items.map((it) =>
            it.header ? (
              <div key={it.id} style={{ paddingLeft: 9, paddingTop: 6, paddingBottom: 3 }}>
                <text style={{ fontFamily: SANS, fontSize: 11.5, color: C.ghost, fontWeight: 500 }}>{it.label}</text>
              </div>
            ) : (
              <SelectItem
                key={it.id}
                value={it.id}
                testId={`${testId}-${it.id}`}
                style={(s) => ({ ...row({ gap: 10 }), width: '100%', paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 8, cursor: 'pointer', backgroundColor: s.highlighted ? C.hover : C.menu, hover: { backgroundColor: C.hover } })}
              >
                {() => (
                  <>
                    {it.icon && <Icon name={it.icon} size={14} color={it.danger ? C.del : C.tertiary} />}
                    <text style={{ fontFamily: SANS, color: it.danger ? C.del : C.text, fontSize: 13.5, flexGrow: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{it.label}</text>
                    {it.hint && <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, whiteSpace: 'nowrap' }}>{it.hint}</text>}
                  </>
                )}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </div>
    </Select>
  )
}

/* ───────────────────────────── Automations ───────────────────────────── */

export function AutomationsView({ api, narrow }: { api: DevinApi | null; narrow?: boolean }) {
  const autos = useApiList<ApiAutomation>(api?.listAutomations?.bind(api), [api])
  const templates = useApiList<ApiTemplate>(api?.listTemplates?.bind(api), [api])
  const [tab, setTab] = useState<'automations' | 'templates'>('automations')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [preset, setPreset] = useState(SCHEDULE_PRESETS[0]!.id)
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  const [category, setCategory] = useState('all')
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
      actions={<Btn testId="automation-new" primary icon="plus" label="Create automation" onClick={() => setCreating((v) => !v)} />}
    >
      {!api && <Notice text="Automations need a Devin API key (see README). Showing nothing in demo mode." />}
      {creating && (
        <Card testId="automation-form">
          <T weight={600}>New scheduled automation</T>
          <Field testId="automation-name" value={name} onChange={setName} placeholder="Name, e.g. Weekday test run" />
          <Field testId="automation-prompt" value={prompt} onChange={setPrompt} placeholder="What should Devin do each run?" multiline />
          <Pills testId="automation-schedule" items={SCHEDULE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={preset} onChange={setPreset} />
          <div style={row({ gap: 8, justifyContent: 'flex-end' })}>
            <Btn label="Cancel" onClick={() => setCreating(false)} />
            <Btn testId="automation-create" primary label="Create" disabled={!name.trim() || !prompt.trim()} onClick={create} />
          </div>
        </Card>
      )}
      {notice && <Notice text={notice.text} tone={notice.tone} />}
      <Pills
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
            <Empty text="No automations yet" />
          ) : (
            autos.items.map((a) => (
              <Card key={a.automation_id} testId={`automation-${a.automation_id}`}>
                <div style={row({ gap: 10 })}>
                  <Icon name="clock" size={15} color={a.enabled ? C.add : C.ghost} />
                  <T weight={500} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{a.name}</T>
                  <T size={12} color={C.tertiary}>{a.enabled ? 'On' : 'Paused'}</T>
                  <Toggle testId={`automation-toggle-${a.automation_id}`} on={a.enabled} onChange={(v) => toggle(a, v)} />
                  <Btn small danger testId={`automation-delete-${a.automation_id}`} label={confirmDelete === a.automation_id ? 'Confirm delete' : 'Delete'} onClick={() => remove(a)} />
                </div>
                <T size={12.5} color={C.tertiary}>{`${a.triggers.map(describeTrigger).join(' · ') || 'No trigger'}  ·  updated ${timeAgo(a.updated_at)}`}</T>
                {a.actions[0]?.prompt && (
                  <T size={12.5} color={C.secondary} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {a.actions[0].prompt.replace(/\s+/g, ' ').slice(0, 220)}
                  </T>
                )}
              </Card>
            ))
          )}
        </div>
      ) : (
        <div style={col({ gap: 10 })}>
          <Pills testId="template-cat" value={category} onChange={setCategory} items={categories.map((c) => ({ value: c, label: c === 'all' ? 'All' : c.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase()) }))} />
          {templates.items === null ? (
            <Empty text="Loading templates…" />
          ) : (
            <div style={row({ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' })}>
              {shownTemplates.map((t) => (
                <Card
                  key={t.template_id}
                  testId={`template-${t.template_id}`}
                  style={{ width: narrow ? '100%' : 260, flexGrow: 1 }}
                  onClick={() => {
                    setName(t.name)
                    setPrompt(t.description)
                    setCreating(true)
                    setTab('automations')
                  }}
                >
                  <T weight={500}>{t.name}</T>
                  <T size={12.5} color={C.tertiary}>{t.description}</T>
                  <T size={11.5} color={C.ghost}>{[t.triggers.map(describeTrigger).join(', '), ...t.required_integrations].filter(Boolean).join(' · ')}</T>
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

function Stat({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 0, minWidth: 120 }}>
      <T size={12.5} color={C.tertiary}>{label}</T>
      <T testId={testId} size={22} weight={600}>{String(value)}</T>
    </Card>
  )
}

export function prStats(sessions: Session[]) {
  const prs = sessions.flatMap((s) => s.live?.prs ?? [])
  const by = (st: string) => prs.filter((p) => (p.state ?? 'open').toLowerCase() === st).length
  return { total: prs.length, open: by('open'), merged: by('merged'), closed: by('closed') }
}

export function SecurityView({ api, sessions, narrow }: { api: DevinApi | null; sessions: Session[]; narrow?: boolean }) {
  const secrets = useApiList<ApiSecret>(api?.listSecrets?.bind(api), [api])
  const s = prStats(sessions)
  return (
    <Page testId="view-security" narrow={narrow} title="Security" subtitle="Pull requests Devin opened, and the secrets it can use." actions={<Btn icon="share" label="Open scans on web" onClick={() => openUrl(`${WEB}/security`)} />}>
      <div style={row({ gap: 10, flexWrap: 'wrap' })}>
        <Stat testId="stat-total" label="Pull requests" value={s.total} />
        <Stat testId="stat-open" label="Open" value={s.open} />
        <Stat testId="stat-merged" label="Merged" value={s.merged} />
        <Stat testId="stat-closed" label="Closed" value={s.closed} />
      </div>
      <T size={12} color={C.ghost}>{`Counted from the ${sessions.length} sessions loaded in the sidebar. Security scan findings aren't in the public API, so they open on app.devin.ai.`}</T>
      <Divider />
      <T weight={600}>{`Secrets${secrets.items ? ` · ${secrets.items.length}` : ''}`}</T>
      <T size={12.5} color={C.tertiary}>Names and notes only. Values never leave Devin.</T>
      {secrets.error && <Notice text={secrets.error} tone="error" />}
      <div style={col({ gap: 6 })} testId="secret-list">
        {(secrets.items ?? []).map((x) => (
          <div key={x.secret_id} style={{ ...row({ gap: 10 }), height: 34, paddingLeft: 12, paddingRight: 12, borderRadius: 8, backgroundColor: C.hover }}>
            <Icon name="shield" size={13} color={C.tertiary} />
            <T mono size={12.5} style={{ flexShrink: 0 }}>{x.key}</T>
            <T size={12} color={C.ghost} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{x.note ?? ''}</T>
            <T size={11.5} color={C.ghost}>{x.secret_type ?? 'secret'}</T>
          </div>
        ))}
        {secrets.items?.length === 0 && <Empty text={api ? 'No secrets' : 'Connect a Devin API key to list secrets'} />}
      </div>
    </Page>
  )
}

/* ───────────────────────────── Review ───────────────────────────── */

export function ReviewView({ sessions, onReview, onOpenSession, narrow }: { sessions: Session[]; onReview: (prUrl: string) => void; onOpenSession: (id: string) => void; narrow?: boolean }) {
  const [url, setUrl] = useState('')
  const [repo, setRepo] = useState('all')
  const [state, setState] = useState<'open' | 'merged' | 'all'>('open')
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
      <div style={row({ gap: 8 })}>
        <div style={{ flexGrow: 1 }}>
          <Field testId="review-url" value={url} onChange={setUrl} placeholder="https://github.com/owner/repo/pull/123" />
        </div>
        <Btn testId="review-start" primary label="Review with Devin" disabled={!valid} onClick={() => valid && onReview(url.trim())} />
      </div>
      <Pills testId="review-state" value={state} onChange={setState} items={[{ value: 'open', label: 'Open' }, { value: 'merged', label: 'Merged' }, { value: 'all', label: 'All' }]} />
      {repos.length > 1 && <Pills testId="review-repo" value={repo} onChange={setRepo} items={[{ value: 'all', label: 'All repos' }, ...repos.map((r) => ({ value: r, label: r.split('/')[1] ?? r }))]} />}
      <div testId="review-list" style={col({ gap: 2 })}>
        {shown.length === 0 && <Empty text="No pull requests match" />}
        {shown.map((p) => (
          <div key={`${p.session.id}-${p.url}`} style={{ ...row({ gap: 10 }), minHeight: 44, paddingLeft: 10, paddingRight: 8, borderRadius: 8, hover: { backgroundColor: C.hover } }}>
            <Icon name={(p.state ?? '').toLowerCase() === 'merged' ? 'merge' : 'pr'} size={15} color={(p.state ?? '').toLowerCase() === 'merged' ? C.blue : C.add} />
            <div style={col({ flexGrow: 1, minWidth: 0 })} onClick={() => onOpenSession(p.session.id)}>
              <T size={13.5} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.session.title}</T>
              <T size={12} color={C.tertiary}>{`${p.repo} #${p.number} · ${p.state ?? 'open'} · ${p.session.updated}`}</T>
            </div>
            <Btn small label="GitHub" icon="share" onClick={() => openUrl(p.url)} />
            {!narrow && <Btn small label="Review" onClick={() => onReview(p.url)} />}
          </div>
        ))}
      </div>
    </Page>
  )
}

/* ───────────────────────────── Customize ───────────────────────────── */

export function CustomizeView({ api, tab, onTab, onUsePlaybook, narrow }: { api: DevinApi | null; tab: 'playbooks' | 'knowledge'; onTab: (t: 'playbooks' | 'knowledge') => void; onUsePlaybook: (pb: ApiPlaybook) => void; narrow?: boolean }) {
  const playbooks = useApiList<ApiPlaybook>(api?.listPlaybooks?.bind(api), [api])
  const notes = useApiList<ApiNote>(api?.listNotes ? () => api.listNotes!() : undefined, [api])
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [macro, setMacro] = useState('')
  const [body, setBody] = useState('')
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

  return (
    <Page
      testId="view-customize"
      narrow={narrow}
      title="Customize"
      subtitle="Playbooks and knowledge Devin uses in every session."
      actions={<Btn testId="customize-new" primary icon="plus" label={tab === 'playbooks' ? 'New playbook' : 'New knowledge'} disabled={!api} onClick={() => setCreating((v) => !v)} />}
    >
      <div style={row({ gap: 12, flexWrap: 'wrap' })}>
        <Pills
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
        <div style={{ flexGrow: 1, minWidth: 180 }}>
          <Field testId="customize-search" value={q} onChange={setQ} placeholder={`Search ${tab}`} />
        </div>
      </div>
      {creating && (
        <Card testId="customize-form">
          <T weight={600}>{tab === 'playbooks' ? 'New playbook' : 'New knowledge'}</T>
          <Field testId="customize-title" value={title} onChange={setTitle} placeholder={tab === 'playbooks' ? 'Title' : 'Name'} />
          <Field testId="customize-macro" value={macro} onChange={setMacro} placeholder={tab === 'playbooks' ? 'Macro, e.g. !release (optional)' : 'When should Devin use this? (trigger)'} />
          <Field testId="customize-body" value={body} onChange={setBody} placeholder={tab === 'playbooks' ? 'Steps, in Markdown' : 'What Devin should know'} multiline />
          <div style={row({ gap: 8, justifyContent: 'flex-end' })}>
            <Btn label="Cancel" onClick={() => setCreating(false)} />
            <Btn testId="customize-create" primary label="Create" disabled={!title.trim() || !body.trim()} onClick={create} />
          </div>
        </Card>
      )}
      {notice && <Notice text={notice.text} tone={notice.tone} />}
      <div testId="customize-list" style={col({ gap: 6 })}>
        {tab === 'playbooks'
          ? playbooks.items === null
            ? <Empty text="Loading playbooks…" />
            : pbs.length === 0
              ? <Empty text={api ? 'No playbooks match' : 'Connect a Devin API key to list playbooks'} />
              : pbs.map((p) => (
                  <Card key={p.playbook_id} testId={`playbook-${p.playbook_id}`}>
                    <div style={row({ gap: 10 })} onClick={() => setOpenId(openId === p.playbook_id ? null : p.playbook_id)}>
                      <Icon name="library" size={14} color={C.tertiary} />
                      <T weight={500} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.title}</T>
                      {p.macro && <T mono size={12} color={C.accent}>{p.macro}</T>}
                      <Icon name={openId === p.playbook_id ? 'chevronDown' : 'chevronRight'} size={13} color={C.ghost} />
                    </div>
                    {openId === p.playbook_id && (
                      <>
                        <markdown style={{ fontFamily: SANS, fontSize: 13, color: C.secondary }}>{p.body.slice(0, 4000)}</markdown>
                        <div style={row({ gap: 8 })}>
                          <Btn testId={`playbook-use-${p.playbook_id}`} small primary label="Use in new session" onClick={() => onUsePlaybook(p)} />
                          <Btn small label="Open on web" icon="share" onClick={() => openUrl(`${WEB}/playbooks/${p.playbook_id}`)} />
                        </div>
                      </>
                    )}
                  </Card>
                ))
          : notes.items === null
            ? <Empty text="Loading knowledge…" />
            : ns.length === 0
              ? <Empty text={api ? 'No knowledge matches' : 'Connect a Devin API key to list knowledge'} />
              : ns.slice(0, 200).map((n) => (
                  <Card key={n.note_id} testId={`note-${n.note_id}`}>
                    <div style={row({ gap: 10 })}>
                      <div style={row({ gap: 10, flexGrow: 1, minWidth: 0 })} onClick={() => setOpenId(openId === n.note_id ? null : n.note_id)}>
                        <Icon name="folder" size={14} color={C.tertiary} />
                        <T weight={500} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.name}</T>
                      </div>
                      {n.pinned_repo && !narrow && <T size={11.5} color={C.ghost}>{n.pinned_repo}</T>}
                      <Toggle testId={`note-toggle-${n.note_id}`} on={n.is_enabled} onChange={(v) => toggleNote(n, v)} />
                    </div>
                    <T size={12} color={C.tertiary} style={{ whiteSpace: openId === n.note_id ? 'normal' : 'nowrap', textOverflow: 'ellipsis' }}>{`${n.folder_path ? `${n.folder_path} · ` : ''}Trigger: ${n.trigger}`}</T>
                    {openId === n.note_id && <markdown style={{ fontFamily: SANS, fontSize: 13, color: C.secondary }}>{n.body.slice(0, 4000)}</markdown>}
                  </Card>
                ))}
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
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const unread = items.filter((n) => n.unread).length
  const shown = tab === 'unread' ? items.filter((n) => n.unread) : items
  return (
    <Page testId="view-notifications" narrow={narrow} title="Notifications" subtitle="Sessions that need you or just finished." actions={<Btn testId="notifications-read" label="Mark all read" disabled={unread === 0} onClick={onMarkAll} />}>
      <Pills testId="notifications-tab" value={tab} onChange={setTab} items={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: unread }]} />
      <div testId="notification-list" style={col({ gap: 2 })}>
        {shown.length === 0 && <Empty text={tab === 'unread' ? 'You’re all caught up' : 'Nothing yet'} />}
        {shown.map((n) => (
          <div key={n.id} testId={`notification-${n.id}`} onClick={() => onOpen(n.id)} style={{ ...row({ gap: 12, alignItems: 'flex-start' }), paddingTop: 9, paddingBottom: 9, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
            <Icon name={n.alert ? 'help' : 'compose'} size={15} color={n.alert ? C.orange : C.tertiary} />
            <div style={col({ flexGrow: 1, minWidth: 0, gap: 1 })}>
              <T size={13.5} weight={n.unread ? 600 : 400} color={n.unread ? C.text : C.secondary} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{n.title}</T>
              <T size={12.5} color={n.alert ? C.orange : C.tertiary}>{n.detail}</T>
            </div>
            <T size={12} color={C.ghost}>{n.session.updated}</T>
            <div style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: n.unread ? C.blue : CLEAR }} />
          </div>
        ))}
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
      { id: 'api', label: 'Devin API', icon: 'zap', page: 'api' },
      { id: 'schedules', label: 'Schedules', icon: 'clock', go: ['automations'] },
      { id: 'knowledge', label: 'Knowledge', icon: 'folder', go: ['customize', 'knowledge'] },
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
  ['⌘,', 'Settings'],
  ['⌘B', 'Show / hide sidebar'],
  ['⌘.', 'Show / hide the right panel'],
  ['Ctrl-C', 'Quit and restore the terminal'],
]

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ ...row({ gap: 16 }), minHeight: 52, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderColor: C.border, flexWrap: 'wrap' }}>
      <div style={col({ flexGrow: 1, minWidth: 180, gap: 2 })}>
        <T weight={500}>{label}</T>
        {hint && <T size={12.5} color={C.tertiary}>{hint}</T>}
      </div>
      {children}
    </div>
  )
}

export type SettingsProps = {
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
  const [page, setPage] = useState<string>(p.initialPage ?? 'preferences')
  const [q, setQ] = useState('')
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
    <div style={{ ...col({ gap: 1 }), width: p.narrow ? '100%' : 230, flexShrink: 0, paddingTop: 20, paddingLeft: 10, paddingRight: 10, borderRightWidth: p.narrow ? 0 : 1, borderColor: C.border, overflowY: 'scroll' }}>
      <div style={{ paddingLeft: 4, paddingRight: 4, paddingBottom: 10 }}>
        <Field testId="settings-search" value={q} onChange={setQ} placeholder="Search settings" />
      </div>
      {SETTINGS_NAV.map((s) => {
        const items = s.items.filter((i) => !needle || i.label.toLowerCase().includes(needle))
        if (!items.length) return null
        return (
          <React.Fragment key={s.section}>
            <div style={{ paddingLeft: 10, paddingTop: 10, paddingBottom: 4 }}>
              <T size={12} color={C.ghost} weight={500}>{s.section}</T>
            </div>
            {items.map((it) => (
              <div key={it.id} testId={`settings-nav-${it.id}`} onClick={() => click(it)} style={{ ...row({ gap: 10 }), height: 32, paddingLeft: 10, paddingRight: 8, borderRadius: 8, cursor: 'pointer', backgroundColor: page === it.id ? C.selected : CLEAR, hover: { backgroundColor: C.hover } }}>
                <Icon name={it.icon} size={14} color={page === it.id ? C.text : C.tertiary} />
                <text style={{ fontFamily: SANS, fontSize: 13.5, color: page === it.id ? C.text : C.secondary, flexGrow: 1 }}>{it.label}</text>
                {(it.web || it.go) && <Icon name={it.web ? 'share' : 'chevronRight'} size={12} color={C.ghost} />}
              </div>
            ))}
          </React.Fragment>
        )
      })}
    </div>
  )

  let body: React.ReactNode
  if (page === 'preferences') {
    body = (
      <Page testId="settings-preferences" narrow={p.narrow} title="Preferences" subtitle="Saved to ~/.config/devin-tui/prefs.json on this machine.">
        <div style={col()}>
          <SettingRow label="Appearance" hint="Also ⇧⌘L. Defaults to your Ghostty theme.">
            <Pills testId="pref-theme" value={p.themeName} onChange={p.onTheme} items={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </SettingRow>
          <SettingRow label="Default agent" hint="Sent as devin_mode when you start a session.">
            <Pills testId="pref-mode" value={p.mode} onChange={p.onMode} items={p.modes} />
          </SettingRow>
          <SettingRow label="Default repository" hint="Attached to new sessions as repos.">
            <Pills testId="pref-repo" value={p.repo} onChange={p.onRepo} items={p.repos.slice(0, 6).map((r) => ({ value: r, label: r.split('/')[1] ?? r }))} />
          </SettingRow>
          <SettingRow label="Renamed sessions" hint={`${p.renamedCount} local title override${p.renamedCount === 1 ? '' : 's'}. The Devin API has no rename, so names stay on this machine.`}>
            <Btn testId="pref-reset-titles" small label="Reset names" disabled={p.renamedCount === 0} onClick={p.onResetTitles} />
          </SettingRow>
        </div>
      </Page>
    )
  } else if (page === 'shortcuts') {
    body = (
      <Page testId="settings-shortcuts" narrow={p.narrow} title="Keyboard shortcuts">
        <div style={col()}>
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} style={{ ...row({ gap: 12 }), height: 40, borderBottomWidth: 1, borderColor: C.border }}>
              <T style={{ flexGrow: 1 }}>{label}</T>
              <div style={{ paddingLeft: 8, paddingRight: 8, height: 24, ...row(), borderRadius: 6, backgroundColor: C.hover }}>
                <T mono size={12} color={C.secondary}>{k}</T>
              </div>
            </div>
          ))}
        </div>
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
    body = (
      <Page testId="settings-api" narrow={p.narrow} title="Devin API" subtitle="devin-tui talks to the Devin v3 API with a personal access token. Save one here instead of exporting environment variables.">
        <div style={col()}>
          <SettingRow label="Status">
            <T testId="api-status" size={13} color={p.api ? C.add : C.orange}>{p.api ? 'Live' : 'Demo data (no key)'}</T>
          </SettingRow>
          <SettingRow label="Organization">
            <T mono size={12.5} color={C.secondary}>{p.orgId ?? '—'}</T>
          </SettingRow>
          <SettingRow label="Endpoint">
            <T mono size={12.5} color={C.secondary}>{`${p.baseUrl}/v3`}</T>
          </SettingRow>
          <SettingRow label="Token" hint="Never shown in full.">
            <T testId="api-key-hint" mono size={12.5} color={C.secondary}>{p.keyHint ?? '—'}</T>
          </SettingRow>
          <SettingRow label="Stored in">
            <T testId="api-key-source" size={13} color={C.secondary}>{sourceLabel}</T>
          </SettingRow>
        </div>
        <div style={row({ gap: 8 })}>
          <Btn testId="api-test" label="Test connection" onClick={testConnection} />
          <Btn label="Create a token on web" icon="share" onClick={() => openUrl(`${WEB}/settings/api-keys`)} />
          <Btn label="API docs" icon="share" onClick={() => openUrl('https://docs.devin.ai/api-reference/overview')} />
        </div>
        {check && <Notice text={check.text} tone={check.tone} />}
        <div style={{ ...col({ gap: 10 }), padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
          <T size={14} weight={600}>{source ? 'Replace API key' : 'Add an API key'}</T>
          {source === 'env' && <Notice text="DEVIN_API_KEY is set in this shell and overrides a saved key. Unset it to use the saved one." />}
          <T size={12.5} color={C.tertiary}>Organization ID</T>
          <Field testId="api-org-input" value={orgDraft} onChange={setOrgDraft} placeholder="org-…" mono />
          <T size={12.5} color={C.tertiary}>Personal access token</T>
          <div style={row({ gap: 8 })}>
            <div style={{ flexGrow: 1 }}>
              <SecretField testId="api-key-input" value={keyDraft} onChange={setKeyDraft} placeholder="Paste your token" reveal={reveal} />
            </div>
            <Btn small testId="api-key-reveal" label={reveal ? 'Hide' : 'Show'} onClick={() => setReveal((r) => !r)} />
          </div>
          <div style={row({ gap: 8 })}>
            <Btn testId="api-key-save" primary label={keyBusy ? 'Saving…' : 'Save key'} disabled={!draftOk || keyBusy || !p.onSaveKey} onClick={() => runKey(true)} />
            <Btn testId="api-key-verify" label="Test this key" disabled={!draftOk || keyBusy} onClick={() => runKey(false)} />
            {p.onRemoveKey && (source === 'keychain' || source === 'file') && (
              <Btn
                testId="api-key-remove"
                danger
                label={confirmRemove ? 'Click again to remove' : 'Remove saved key'}
                onClick={() => {
                  if (!confirmRemove) return setConfirmRemove(true)
                  setConfirmRemove(false)
                  p.onRemoveKey?.().catch((e: Error) => setKeyMsg({ text: e.message, tone: 'error' }))
                }}
              />
            )}
          </div>
          {keyMsg && <Notice text={keyMsg.text} tone={keyMsg.tone} />}
          <T size={12} color={C.ghost}>The key is checked against the API before it's saved. On macOS it goes to the Keychain (service “devin-tui”); elsewhere to ~/.config/devin-tui/config.json with 0600 permissions. Environment variables still take priority.</T>
        </div>
      </Page>
    )
  } else {
    body = (
      <Page testId="settings-web" narrow={p.narrow} title={current.label} subtitle="This page isn't in the public Devin API, so it opened on app.devin.ai in your browser.">
        <div style={row({ gap: 8 })}>
          <Btn primary icon="share" label="Open again" onClick={() => openUrl(`${WEB}${current.web ?? ''}`)} />
        </div>
      </Page>
    )
  }
  return (
    <div testId="view-settings" style={{ ...(p.narrow ? col() : row({ alignItems: 'stretch' })), flexGrow: 1, minHeight: 0 }}>
      {(!p.narrow || page === 'menu') && nav}
      {p.narrow ? (
        <div style={{ ...col(), flexGrow: 1, minHeight: 0 }}>
          <div style={{ ...row({ gap: 8 }), paddingLeft: 12, paddingTop: 8 }}>
            {SETTINGS_NAV[0]!.items.concat(SETTINGS_NAV[1]!.items.slice(0, 1)).filter((i) => i.page).map((i) => (
              <div key={i.id} testId={`settings-nav-${i.id}`} onClick={() => setPage(i.id)} style={{ ...row(), height: 26, paddingLeft: 9, paddingRight: 9, borderRadius: 13, cursor: 'pointer', backgroundColor: page === i.id ? C.selected : CLEAR }}>
                <T size={12.5} color={page === i.id ? C.text : C.tertiary}>{i.label}</T>
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
