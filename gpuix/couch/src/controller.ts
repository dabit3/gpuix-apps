import type { Item, Library } from './library/model.ts'
import { buildRows, gridMove, nextEpisode, seasonsOf, visibleTo, type Row } from './rows.ts'
import { profileState, recordPosition, saveState, type ProfileState, type SavedState } from './state.ts'
import { decodeSize, Decoder, type DecoderEvents, type FrameSize } from './player/decoder.ts'

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home'
  | 'play' | 'ffwd' | 'rew' | 'hud' | 'info' | 'next' | 'prev'

export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'play', 'ffwd', 'rew', 'hud', 'info', 'next', 'prev']

export type Screen = 'profiles' | 'browse' | 'details' | 'player'
export type Tab = 'home' | 'movies' | 'shows'
export const TABS: Tab[] = ['home', 'movies', 'shows']

export interface Profile { name: string; color: number; kids?: boolean }

export interface PlayerView {
  id: string
  pos: number
  dur: number
  playing: boolean
  ended: boolean
  scrub: number | null
  osd: boolean
  audio: 'on' | 'none' | 'muted'
  size: FrameSize
}

export interface View {
  screen: Screen
  profiles: Profile[]
  profileIdx: number
  profile?: Profile
  tab: Tab
  navFocus: boolean
  row: number
  /** True while the focused shelf came from mouse hover, so the shelves don't scroll under the pointer. */
  hoverRow?: boolean
  cols: Record<string, number>
  grid: Record<Tab, number>
  gridCols: number
  detailsId?: string
  detailsZone: 'actions' | 'episodes'
  actionIdx: number
  season: number
  episodeIdx: number
  player?: PlayerView
  hud: boolean
  toast?: { text: string; at: number }
  pointer: boolean
}

export interface ControllerOptions {
  profiles: Profile[]
  mute?: boolean
  save?: (s: SavedState) => void
  decoder?: (item: Item, size: FrameSize, ev: DecoderEvents) => Pick<Decoder, 'start' | 'stop' | 'pos' | 'rate' | 'spawns' | 'running'>
  scrubCommitMs?: number
}

type DecoderLike = ReturnType<NonNullable<ControllerOptions['decoder']>>

export const SCRUB_STEP = 10

/** All navigation, playback and persistence logic; the React tree just renders `view`. */
export class Controller {
  view: View
  rows: Row[] = []
  private listeners = new Set<() => void>()
  private frameSink?: (frame: Uint8Array, size: FrameSize) => void
  private previewSink?: (sec: number) => void
  private decoder?: DecoderLike
  private scrubTimer?: ReturnType<typeof setTimeout>
  private posTick = 0
  private history: Screen[] = []
  decoderSpawns = 0
  lastAction?: { action: Action; at: number; source: string }
  readonly onStatus = new Set<(s: ReturnType<Controller['status']>) => void>()

  constructor(public lib: Library, public saved: SavedState, private opts: ControllerOptions) {
    const last = opts.profiles.findIndex((p) => p.name === saved.lastProfile)
    this.view = {
      screen: 'profiles', profiles: opts.profiles, profileIdx: Math.max(0, last), tab: 'home', navFocus: false,
      row: 0, cols: {}, grid: { home: 0, movies: 0, shows: 0 }, gridCols: 5,
      detailsZone: 'actions', actionIdx: 0, season: 0, episodeIdx: 0, hud: false, pointer: false,
    }
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getView = () => this.view

  private set(patch: Partial<View>) {
    this.view = { ...this.view, ...patch }
    if ('row' in patch && !('hoverRow' in patch)) this.view.hoverRow = false
    for (const l of this.listeners) l()
    const s = this.status()
    for (const l of this.onStatus) l(s)
  }

  setFrameSink(fn?: (frame: Uint8Array, size: FrameSize) => void) { this.frameSink = fn }
  setPreviewSink(fn?: (sec: number) => void) { this.previewSink = fn }

  get prof(): ProfileState | undefined {
    return this.view.profile ? profileState(this.saved, this.view.profile.name) : undefined
  }

  item(id: string | undefined): Item | undefined { return id ? this.lib.items[id] : undefined }

  toast(text: string) { this.set({ toast: { text, at: Date.now() } }) }

  setLibrary(lib: Library) {
    const before = new Set(Object.keys(this.lib.items))
    this.lib = lib
    this.rebuild()
    const added = [...lib.movies, ...lib.shows].filter((id) => !before.has(id))
    if (added.length && before.size) this.toast(`Added ${lib.items[added[0]!]!.title}${added.length > 1 ? ` +${added.length - 1}` : ''}`)
  }

  rebuild() {
    this.rows = buildRows(this.lib, this.prof, this.view.profile?.kids)
    const row = Math.min(this.view.row, Math.max(0, this.rows.length - 1))
    this.set({ row })
  }

  touched() { this.set({}) }

  setGridCols(n: number) { if (n !== this.view.gridCols) this.set({ gridCols: n }) }

  setPointer(on: boolean) { if (on !== this.view.pointer) this.view = { ...this.view, pointer: on } }

  /** Mouse hover focus on the home rows; only after the pointer actually moved, so keys keep focus stable. */
  hoverRow(row: number, col: number) {
    const v = this.view
    const r = this.rows[row]
    if (!v.pointer || !r || v.screen !== 'browse') return
    if (v.row === row && this.colOf(r) === col && !v.navFocus) return
    this.set({ row, hoverRow: true, navFocus: false, cols: { ...v.cols, [r.key]: col } })
  }

  hoverGrid(idx: number) {
    const v = this.view
    if (!v.pointer || v.screen !== 'browse' || v.tab === 'home') return
    if (v.grid[v.tab] === idx && !v.navFocus) return
    this.set({ navFocus: false, grid: { ...v.grid, [v.tab]: idx } })
  }

  hoverEpisode(idx: number) {
    if (!this.view.pointer || this.view.screen !== 'details') return
    if (this.view.detailsZone === 'episodes' && this.view.episodeIdx === idx) return
    this.set({ detailsZone: 'episodes', episodeIdx: idx })
  }

  hoverAction(idx: number) {
    if (!this.view.pointer || this.view.screen !== 'details') return
    if (this.view.detailsZone === 'actions' && this.view.actionIdx === idx) return
    this.set({ detailsZone: 'actions', actionIdx: idx })
  }

  setSeason(i: number) { this.set({ season: i, episodeIdx: 0, detailsZone: 'episodes' }) }

  // ---------- selection helpers ----------
  gridIds(tab: Tab = this.view.tab): string[] {
    const kids = !!this.view.profile?.kids
    const ids = tab === 'shows' ? this.lib.shows : this.lib.movies
    return ids.filter((id) => visibleTo(this.lib.items[id]!, kids))
  }

  colOf(row: Row | undefined): number {
    if (!row) return 0
    return Math.min(this.view.cols[row.key] ?? 0, row.ids.length - 1)
  }

  /** The item that currently has focus on the browse screen. */
  focusedId(): string | undefined {
    const v = this.view
    if (v.screen !== 'browse') return v.detailsId
    if (v.tab === 'home') {
      const r = this.rows[v.row]
      return r?.ids[this.colOf(r)]
    }
    return this.gridIds()[v.grid[v.tab]]
  }

  detailsActions(): string[] {
    const it = this.item(this.view.detailsId)
    if (!it) return []
    if (it.kind === 'show') {
      const next = nextEpisode(this.lib, it, this.prof)
      const r = next ? this.prof?.resume[next] : undefined
      return [r ? 'Resume' : 'Play', 'Watched']
    }
    const r = this.prof?.resume[it.id]
    return r ? ['Resume', 'Restart', 'Watched'] : ['Play', 'Watched']
  }

  episodesInSeason(): string[] {
    const show = this.item(this.view.detailsId)
    if (!show || show.kind !== 'show') return []
    const seasons = seasonsOf(this.lib, show)
    const s = seasons[Math.min(this.view.season, seasons.length - 1)]
    return (show.episodes ?? []).filter((e) => this.lib.items[e]!.season === s)
  }

  // ---------- navigation ----------
  selectProfile(idx = this.view.profileIdx) {
    const profile = this.view.profiles[idx]
    if (!profile) return
    this.saved.lastProfile = profile.name
    this.persist()
    this.history = []
    this.view = { ...this.view, profileIdx: idx, profile, screen: 'browse', tab: 'home', row: 0, cols: {}, navFocus: false, grid: { home: 0, movies: 0, shows: 0 } }
    this.rebuild()
  }

  private go(screen: Screen, patch: Partial<View> = {}) {
    if (this.view.screen !== screen) this.history.push(this.view.screen)
    this.set({ ...patch, screen })
  }

  open(id: string) {
    const it = this.item(id)
    if (!it) return
    if (it.kind === 'episode') {
      const show = this.item(it.showId)!
      const seasons = seasonsOf(this.lib, show)
      const season = Math.max(0, seasons.indexOf(it.season!))
      const eps = (show.episodes ?? []).filter((e) => this.lib.items[e]!.season === it.season)
      this.go('details', { detailsId: show.id, detailsZone: 'episodes', season, episodeIdx: Math.max(0, eps.indexOf(id)), actionIdx: 0 })
      return
    }
    let season = 0, episodeIdx = 0
    if (it.kind === 'show') {
      const next = nextEpisode(this.lib, it, this.prof)
      if (next) {
        const ep = this.lib.items[next]!
        season = Math.max(0, seasonsOf(this.lib, it).indexOf(ep.season!))
        episodeIdx = Math.max(0, (it.episodes ?? []).filter((e) => this.lib.items[e]!.season === ep.season).indexOf(next))
      }
    }
    this.go('details', { detailsId: id, detailsZone: 'actions', actionIdx: 0, season, episodeIdx })
  }

  back() {
    const v = this.view
    if (v.screen === 'player') return this.stopPlayback()
    if (v.screen === 'details') {
      const prev = this.history.pop() ?? 'browse'
      return this.set({ screen: prev === 'details' || prev === 'player' ? 'browse' : prev })
    }
    if (v.screen === 'browse') {
      if (!v.navFocus && (v.tab !== 'home' ? v.grid[v.tab] > 0 : v.row > 0)) {
        return this.set(v.tab === 'home' ? { row: 0 } : { grid: { ...v.grid, [v.tab]: 0 } })
      }
      if (!v.navFocus) return this.set({ navFocus: true })
      this.history = []
      return this.set({ screen: 'profiles', navFocus: false })
    }
  }

  setTab(tab: Tab) { this.set({ tab, navFocus: this.view.navFocus }) }

  /** Remote-style action dispatcher shared by keyboard, mouse buttons and the `couch remote` socket. */
  dispatch(action: Action, source = 'keyboard') {
    this.lastAction = { action, at: Date.now(), source }
    const v = this.view
    if (action === 'hud') return this.set({ hud: !v.hud })
    if (action === 'home' && v.screen !== 'profiles') {
      if (v.screen === 'player') this.stopPlayback(false)
      this.history = []
      return this.set({ screen: 'browse', tab: 'home', navFocus: false, row: 0 })
    }
    if (action === 'back') return this.back()
    switch (v.screen) {
      case 'profiles': return this.onProfiles(action)
      case 'browse': return this.onBrowse(action)
      case 'details': return this.onDetails(action)
      case 'player': return this.onPlayer(action)
    }
  }

  private onProfiles(a: Action) {
    const v = this.view, n = v.profiles.length
    if (a === 'left' || a === 'up') this.set({ profileIdx: (v.profileIdx + n - 1) % n })
    else if (a === 'right' || a === 'down') this.set({ profileIdx: (v.profileIdx + 1) % n })
    else if (a === 'ok' || a === 'play') this.selectProfile()
  }

  private onBrowse(a: Action) {
    const v = this.view
    if (v.navFocus) {
      const i = TABS.indexOf(v.tab)
      if (a === 'left') return this.set({ tab: TABS[Math.max(0, i - 1)]! })
      if (a === 'right') return this.set({ tab: TABS[Math.min(TABS.length - 1, i + 1)]! })
      if (a === 'down' || a === 'ok') return this.set({ navFocus: false })
      return
    }
    if (a === 'ok' || a === 'info') {
      const id = this.focusedId()
      const row = v.tab === 'home' ? this.rows[v.row] : undefined
      if (id && row?.key === 'continue' && a === 'ok') return this.play(id)
      if (id) this.open(id)
      return
    }
    if (a === 'play') {
      const id = this.focusedId()
      if (id) this.play(id)
      return
    }
    if (v.tab === 'home') {
      const row = this.rows[v.row]
      if (a === 'up') return v.row === 0 ? this.set({ navFocus: true }) : this.set({ row: v.row - 1 })
      if (a === 'down' || a === 'next') return this.set({ row: Math.min(this.rows.length - 1, v.row + 1) })
      if (a === 'prev') return this.set({ row: Math.max(0, v.row - 1) })
      if (row && (a === 'left' || a === 'right' || a === 'ffwd' || a === 'rew')) {
        const step = a === 'ffwd' ? 4 : a === 'rew' ? -4 : a === 'left' ? -1 : 1
        const col = Math.max(0, Math.min(row.ids.length - 1, this.colOf(row) + step))
        return this.set({ cols: { ...v.cols, [row.key]: col } })
      }
      return
    }
    const ids = this.gridIds()
    const idx = v.grid[v.tab]
    if (a === 'up' && idx < v.gridCols) return this.set({ navFocus: true })
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      return this.set({ grid: { ...v.grid, [v.tab]: gridMove(idx, ids.length, v.gridCols, a) } })
    }
  }

  private onDetails(a: Action) {
    const v = this.view
    const show = this.item(v.detailsId)
    if (!show) return
    const isShow = show.kind === 'show'
    if (v.detailsZone === 'actions') {
      const acts = this.detailsActions()
      if (a === 'left') return this.set({ actionIdx: Math.max(0, v.actionIdx - 1) })
      if (a === 'right') return this.set({ actionIdx: Math.min(acts.length - 1, v.actionIdx + 1) })
      if (a === 'down' && isShow) return this.set({ detailsZone: 'episodes' })
      if (a === 'play') return this.runAction('Play')
      if (a === 'ok') return this.runAction(acts[v.actionIdx]!)
      return
    }
    const eps = this.episodesInSeason()
    const seasons = seasonsOf(this.lib, show)
    if (a === 'up') return v.episodeIdx === 0 ? this.set({ detailsZone: 'actions' }) : this.set({ episodeIdx: v.episodeIdx - 1 })
    if (a === 'down') return this.set({ episodeIdx: Math.min(eps.length - 1, v.episodeIdx + 1) })
    if (a === 'left' || a === 'right') {
      const season = Math.max(0, Math.min(seasons.length - 1, v.season + (a === 'left' ? -1 : 1)))
      return this.set({ season, episodeIdx: 0 })
    }
    if (a === 'ok' || a === 'play') {
      const id = eps[v.episodeIdx]
      if (id) this.play(id)
    }
  }

  runAction(name: string) {
    const it = this.item(this.view.detailsId)
    if (!it) return
    const target = it.kind === 'show' ? nextEpisode(this.lib, it, this.prof) : it.id
    if (!target) return
    if (name === 'Play' || name === 'Resume') return this.play(target)
    if (name === 'Restart') return this.play(target, 0)
    if (name === 'Watched') {
      const p = this.prof!
      const ids = it.kind === 'show' ? it.episodes ?? [] : [it.id]
      const all = ids.every((id) => p.watched[id])
      for (const id of ids) {
        if (all) delete p.watched[id]
        else { p.watched[id] = Date.now(); delete p.resume[id] }
      }
      this.persist()
      this.rebuild()
      this.set({ actionIdx: Math.min(this.view.actionIdx, this.detailsActions().length - 1) })
      this.toast(all ? 'Marked unwatched' : 'Marked watched')
    }
  }

  // ---------- playback ----------
  play(id: string, from?: number) {
    const it = this.item(id)
    if (!it || !(it.path || it.remote)) return
    this.stopDecoder()
    const dur = it.probe?.duration ?? 0
    const resume = this.prof?.resume[id]
    let pos = from ?? (resume ? resume.pos : 0)
    if (dur && pos > dur - 3) pos = 0
    const size = decodeSize(it.probe?.width ?? 1280, it.probe?.height ?? 720)
    const ev: DecoderEvents = {
      onFrame: (frame, sz, p) => {
        this.frameSink?.(frame, sz)
        const now = performance.now()
        if (now - this.posTick > 200) {
          this.posTick = now
          const pv = this.view.player
          if (pv && pv.id === id) this.set({ player: { ...pv, pos: p } })
        }
      },
      onEnd: () => {
        const pv = this.view.player
        if (pv && pv.id === id && pv.playing) {
          this.set({ player: { ...pv, pos: dur || pv.pos, playing: false, ended: true, osd: true } })
          this.savePosition()
        }
      },
      onAudio: (ok) => {
        const pv = this.view.player
        if (!ok && pv && pv.id === id) this.set({ player: { ...pv, audio: 'none' } })
      },
    }
    const factory = this.opts.decoder ?? ((item, sz, e) => new Decoder(item.remote?.stream ?? item.path!, sz, item.probe?.fps ?? 24, item.probe?.duration ?? 0, e, this.opts.mute))
    this.decoder = factory(it, size, ev)
    this.decoderSpawns++
    this.decoder.start(pos)
    this.go('player', { player: { id, pos, dur, playing: true, ended: false, scrub: null, osd: true, audio: this.opts.mute ? 'muted' : 'on', size } })
    this.flashOsd()
  }

  private osdTimer?: ReturnType<typeof setTimeout>
  flashOsd(ms = 2600) {
    clearTimeout(this.osdTimer)
    const pv = this.view.player
    if (pv && !pv.osd) this.set({ player: { ...pv, osd: true } })
    this.osdTimer = setTimeout(() => {
      const p = this.view.player
      if (p && p.playing && p.scrub === null) this.set({ player: { ...p, osd: false } })
    }, ms)
  }

  togglePlay() {
    const pv = this.view.player
    if (!pv || !this.decoder) return
    if (pv.scrub !== null) return this.commitScrub()
    if (pv.playing) {
      const pos = this.decoder.pos
      this.decoder.stop()
      this.set({ player: { ...pv, pos, playing: false, osd: true } })
      this.savePosition()
    } else {
      const from = pv.ended ? 0 : pv.pos
      this.decoder.start(from)
      this.set({ player: { ...pv, pos: from, playing: true, ended: false } })
      this.flashOsd()
    }
  }

  /** Start or extend a scrub; playback continues underneath until the scrub commits. */
  scrubBy(delta: number) {
    const pv = this.view.player
    if (!pv) return
    const base = pv.scrub ?? pv.pos
    this.scrubTo(base + delta)
  }

  scrubTo(sec: number, commitAfter = this.opts.scrubCommitMs ?? 900) {
    const pv = this.view.player
    if (!pv) return
    const scrub = Math.max(0, Math.min(pv.dur || sec, sec))
    this.set({ player: { ...pv, scrub, osd: true } })
    this.previewSink?.(scrub)
    clearTimeout(this.scrubTimer)
    if (commitAfter >= 0) this.scrubTimer = setTimeout(() => this.commitScrub(), commitAfter)
  }

  commitScrub() {
    clearTimeout(this.scrubTimer)
    const pv = this.view.player
    if (!pv || pv.scrub === null || !this.decoder) return
    const to = pv.scrub
    this.decoder.start(to)
    this.set({ player: { ...pv, pos: to, scrub: null, playing: true, ended: false } })
    this.flashOsd()
  }

  cancelScrub() {
    clearTimeout(this.scrubTimer)
    const pv = this.view.player
    if (pv && pv.scrub !== null) this.set({ player: { ...pv, scrub: null } })
  }

  private onPlayer(a: Action) {
    const pv = this.view.player
    if (!pv) return
    if (a === 'ok' || a === 'play') return this.togglePlay()
    if (a === 'left' || a === 'rew') return this.scrubBy(a === 'rew' ? -30 : -SCRUB_STEP)
    if (a === 'right' || a === 'ffwd') return this.scrubBy(a === 'ffwd' ? 30 : SCRUB_STEP)
    if (a === 'up' || a === 'down' || a === 'info') {
      if (pv.osd && a === 'down' && pv.playing) return this.set({ player: { ...pv, osd: false } })
      return this.flashOsd()
    }
    if (a === 'next' || a === 'prev') {
      const it = this.item(pv.id)
      const show = this.item(it?.showId)
      const eps = show?.episodes ?? []
      const j = eps.indexOf(pv.id) + (a === 'next' ? 1 : -1)
      if (eps[j]) { this.history.pop(); this.play(eps[j]!, 0) }
    }
  }

  private savePosition() {
    const pv = this.view.player
    const p = this.prof
    if (!pv || !p) return
    const pos = pv.ended ? pv.dur : this.decoder?.running ? this.decoder.pos : pv.pos
    recordPosition(p, pv.id, pos, pv.dur)
    this.persist()
  }

  private stopDecoder() {
    clearTimeout(this.scrubTimer)
    clearTimeout(this.osdTimer)
    this.decoder?.stop()
  }

  stopPlayback(goBack = true) {
    const pv = this.view.player
    if (pv && pv.playing && this.decoder) this.view = { ...this.view, player: { ...pv, pos: this.decoder.pos } }
    this.savePosition()
    this.stopDecoder()
    this.decoder = undefined
    this.rebuild()
    if (goBack) {
      const prev = this.history.pop() ?? 'browse'
      this.set({ screen: prev === 'player' ? 'browse' : prev, player: undefined })
    } else this.set({ player: undefined })
  }

  get decodeRate() { return this.decoder?.rate ?? 0 }

  persist() { (this.opts.save ?? saveState)(this.saved) }

  dispose() {
    if (this.view.player) this.stopPlayback(false)
    this.stopDecoder()
  }

  /** Small JSON snapshot for `couch remote` clients. */
  status() {
    const v = this.view
    const pv = v.player
    const it = this.item(pv?.id ?? this.focusedId())
    return {
      screen: v.screen,
      profile: v.profile?.name,
      title: it ? (it.kind === 'episode' ? `${this.item(it.showId)?.title ?? ''} · S${it.season}E${it.episode} ${it.title}` : it.title) : undefined,
      playing: pv?.playing ?? false,
      pos: pv?.pos ?? 0,
      dur: pv?.dur ?? 0,
    }
  }
}
