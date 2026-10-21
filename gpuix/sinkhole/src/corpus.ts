// Query mix for the bench and the built-in seed list. Ad/tracker names are the well-known ones every hosts list carries.

export const AD_DOMAINS = [
  'doubleclick.net', 'ad.doubleclick.net', 'stats.g.doubleclick.net', 'googleads.g.doubleclick.net', 'pagead2.googlesyndication.com',
  'googlesyndication.com', 'google-analytics.com', 'www.google-analytics.com', 'ssl.google-analytics.com', 'adservice.google.com',
  'www.googletagmanager.com', 'googletagservices.com', 'www.googletagservices.com', 'app-measurement.com', 'scorecardresearch.com',
  'sb.scorecardresearch.com', 'taboola.com', 'cdn.taboola.com', 'outbrain.com', 'widgets.outbrain.com', 'criteo.com', 'static.criteo.net',
  'amazon-adsystem.com', 'aax.amazon-adsystem.com', 'adnxs.com', 'ib.adnxs.com', 'hotjar.com', 'static.hotjar.com', 'ads.yahoo.com',
  'moatads.com', 'quantserve.com', 'rubiconproject.com', 'casalemedia.com', 'openx.net', 'adsrvr.org', 'bat.bing.com',
  'api.mixpanel.com', 'cdn.segment.com', 'app.adjust.com', 'doubleverify.com', 'adform.net', 'track.adform.net',
]

export const NORMAL_DOMAINS = [
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'google.com', 'www.google.com',
  'apple.com', 'www.apple.com', 'icloud.com', 'wikipedia.org', 'en.wikipedia.org', 'upload.wikimedia.org', 'cloudflare.com',
  'www.cloudflare.com', 'nytimes.com', 'www.nytimes.com', 'bbc.co.uk', 'www.bbc.com', 'reddit.com', 'www.reddit.com', 'news.ycombinator.com',
  'stackoverflow.com', 'npmjs.com', 'registry.npmjs.org', 'bun.sh', 'zed.dev', 'ghostty.org', 'mozilla.org', 'developer.mozilla.org',
  'rust-lang.org', 'crates.io', 'python.org', 'pypi.org', 'youtube.com', 'www.youtube.com', 'i.ytimg.com', 'x.com', 'abs.twimg.com',
  'linkedin.com', 'amazon.com', 'www.amazon.com', 'netflix.com', 'spotify.com', 'open.spotify.com', 'figma.com', 'notion.so',
  'linear.app', 'vercel.com', 'fastly.com', 'akamai.com', 'microsoft.com', 'www.microsoft.com', 'openai.com', 'anthropic.com',
  'duckduckgo.com', 'archive.org', 'theverge.com', 'arstechnica.com', 'kitty.sh', 'sw.kovidgoyal.net',
]

/** Deterministic xorshift so bench runs are repeatable. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
}

export interface BenchItem { name: string; qtype: 'A' | 'AAAA'; ad: boolean }

/** `n` queries, ~30% ad/tracker names, repeats included (so the cache gets exercised like a real browser would). */
export function mixedQueries(n: number, seed = 7, adShare = 0.3): BenchItem[] {
  const r = rng(seed)
  const out: BenchItem[] = []
  for (let i = 0; i < n; i++) {
    const ad = r() < adShare
    const pool = ad ? AD_DOMAINS : NORMAL_DOMAINS
    // Zipf-ish: popular names come up far more often.
    const idx = Math.min(pool.length - 1, Math.floor(pool.length * r() ** 1.8))
    out.push({ name: pool[idx]!, qtype: r() < 0.75 ? 'A' : 'AAAA', ad })
  }
  return out
}
