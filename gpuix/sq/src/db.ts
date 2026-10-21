/** SQLite access for sq: schema introspection, queries, plans and change polling. */
import { Database } from 'bun:sqlite'
import { statSync } from 'node:fs'

export interface Column { name: string; type: string; pk: boolean; notnull: boolean }
export interface TableInfo { name: string; kind: 'table' | 'view'; columns: Column[]; rows: number | null }
export interface QueryResult {
  sql: string
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  ms: number
  changes: number
  isSelect: boolean
}
export interface PlanRow { id: number; parent: number; detail: string }

export const MAX_ROWS = 2_000_000

export class SqDb {
  db: Database
  private lastVersion = 0
  private lastStamp = ''
  constructor(public path: string) {
    this.db = new Database(path, { create: false, readwrite: true })
    this.db.exec('PRAGMA busy_timeout = 2000')
    this.lastVersion = this.dataVersion()
    this.lastStamp = this.fileStamp()
  }
  close() {
    this.db.close()
  }
  /**
   * One-row read on a statement that is finalized right away. A cached
   * `db.query(...).get()` statement stays mid-step, which keeps its read
   * transaction open and pins the connection to an old snapshot: external
   * writes would never show up.
   */
  private one<T>(sql: string): T {
    const stmt = this.db.prepare(sql)
    try {
      return stmt.get() as T
    } finally {
      stmt.finalize()
    }
  }
  private all<T>(sql: string): T[] {
    const stmt = this.db.prepare(sql)
    try {
      return stmt.all() as T[]
    } finally {
      stmt.finalize()
    }
  }
  dataVersion(): number {
    return this.one<{ data_version: number }>('PRAGMA data_version').data_version
  }
  /** Size + mtime of the database and its WAL: changes on every commit by any process. */
  fileStamp(): string {
    const part = (p: string) => {
      try {
        const st = statSync(p)
        return `${st.size}:${st.mtimeMs}`
      } catch {
        return '-'
      }
    }
    return `${part(this.path)}|${part(`${this.path}-wal`)}`
  }
  /** True once per external write (another connection or process committed). */
  changedExternally(): boolean {
    const v = this.dataVersion()
    const stamp = this.fileStamp()
    if (v === this.lastVersion && stamp === this.lastStamp) return false
    this.lastVersion = v
    this.lastStamp = stamp
    return true
  }
  schema(countRows = true): TableInfo[] {
    const objs = this.all<{ name: string; type: string }>("SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
    return objs.map((o) => {
      const cols = this.all<{ name: string; type: string; pk: number; notnull: number }>(`PRAGMA table_info(${quoteIdent(o.name)})`)
      let rows: number | null = null
      if (countRows && o.type === 'table') rows = this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdent(o.name)}`).n
      return { name: o.name, kind: o.type as 'table' | 'view', columns: cols.map((c) => ({ name: c.name, type: c.type || 'ANY', pk: c.pk > 0, notnull: c.notnull === 1 })), rows }
    })
  }
  run(sql: string, maxRows = MAX_ROWS): QueryResult {
    const t0 = performance.now()
    const stmt = this.db.prepare(sql)
    const columns = stmt.columnNames
    const isSelect = columns.length > 0
    const rows: unknown[][] = []
    let truncated = false
    let changes = 0
    if (isSelect) {
      for (const r of stmt.iterate() as Iterable<Record<string, unknown>>) {
        if (rows.length >= maxRows) { truncated = true; break }
        rows.push(columns.map((c) => r[c]))
      }
    } else {
      changes = stmt.run().changes
      this.lastVersion = this.dataVersion()
      this.lastStamp = this.fileStamp()
    }
    stmt.finalize()
    return { sql, columns, rows, truncated, ms: performance.now() - t0, changes, isSelect }
  }
  plan(sql: string): PlanRow[] {
    return (this.all<{ id: number; parent: number; detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((r) => ({ id: r.id, parent: r.parent, detail: r.detail }))
  }
}

export const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  if (v instanceof Uint8Array) return `<blob ${v.length} B>`
  return String(v)
}
