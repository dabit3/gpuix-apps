/** Turns what was typed in the omnibox into a URL: a URL, a bare host, a local path, or a DuckDuckGo search. */
export function resolveInput(raw: string, searchBase = 'https://html.duckduckgo.com/html/?q='): string {
  const s = raw.trim()
  if (!s) return 'about:blank'
  if (/^(about|data|chrome|file|view-source|javascript):/i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('/') || s.startsWith('~/')) return `file://${s.startsWith('~/') ? (process.env.HOME ?? '') + s.slice(1) : s}`
  if (/\s/.test(s)) return searchBase + encodeURIComponent(s)
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(s)) return `http://${s}`
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return `http://${s}`
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s)) return `https://${s}`
  return searchBase + encodeURIComponent(s)
}

export type Security = 'secure' | 'insecure' | 'local' | 'none'
export function securityOf(url: string): Security {
  if (/^https:/i.test(url)) return 'secure'
  if (/^http:\/\/(localhost|127\.|\[::1\])/i.test(url)) return 'local'
  if (/^http:/i.test(url)) return 'insecure'
  if (/^file:/i.test(url)) return 'local'
  return 'none'
}

/** URL shown in the omnibox when it isn't focused: drop the scheme and trailing slash like Chrome. */
export function displayUrl(url: string): string {
  if (!url || url === 'about:blank') return ''
  return url.replace(/^https:\/\//, '').replace(/^http:\/\/(?=localhost|127\.)/, '').replace(/^(www\.)?([^/]+)\/$/, '$1$2')
}

export function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}
