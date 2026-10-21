export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function orderNumber(seq: number, date = new Date('2026-10-21T12:00:00Z')): string {
  const y = date.getUTCFullYear().toString().slice(2)
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `AC-${y}${m}-${String(seq).padStart(5, '0')}`
}
