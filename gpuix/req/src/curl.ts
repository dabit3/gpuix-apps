import type { WireRequest } from './http'

/** Single quotes, unless the value references a shell variable like $GITHUB_PAT that the shell should expand. */
const quote = (s: string) =>
  /\$[A-Z_][A-Z0-9_]*/.test(s) ? `"${s.replace(/["\\`]/g, '\\$&')}"` : `'${s.replace(/'/g, `'\\''`)}'`

/** An env for interpolate() that leaves `$NAME` references in place instead of reading secrets. */
export const shellRefs = new Proxy({} as NodeJS.ProcessEnv, { get: (_, name) => `$${String(name)}`, has: () => true })

export function toCurl(request: WireRequest): string {
  const parts = ['curl']
  if (request.method !== 'GET') parts.push('-X', request.method)
  parts.push(quote(request.url))
  for (const [k, v] of request.headers) if (k.trim()) parts.push('-H', quote(`${k}: ${v}`))
  if (request.body && request.method !== 'GET' && request.method !== 'HEAD') parts.push('--data-raw', quote(request.body))
  return parts.join(' ')
}
