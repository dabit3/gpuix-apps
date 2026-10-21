export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : n >= 100 ? 0 : digits)} ${units[i]}`
}

export const rate = (n: number) => `${bytes(n)}/s`

export function pct(v: number, digits = 0): string {
  return `${(Number.isFinite(v) ? v : 0).toFixed(digits)}%`
}

export function duration(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(sec % 60)}s`
}
