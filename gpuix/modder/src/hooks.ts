// explore-code for Grovekeep: index hook emit sites and the mod API from the game's own source,
// read locally. Managed engines (Unity Mono, XNA) would use ilspycmd here into workspace/decomp.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Recon } from './recon'

export interface Hook { kind: 'event' | 'api' | 'console'; name: string; file: string; line: number; detail: string }

export function scanHooks(r: Recon): { hooks: Hook[]; note: string } {
  if (r.engineId !== 'grovekeep') {
    return { hooks: [], note: `${r.engine}: explore-code needs a local decompiler (${/unity|monogame|tmod/.test(r.engineId) ? 'ilspycmd → workspace/decomp, gitignored' : r.engineId === 'godot' ? 'GDRE tools' : r.engineId === 'unreal' ? 'UE4SS object dump' : 'engine-specific tooling'}). Not run on fixtures.` }
  }
  const hooks: Hook[] = []
  const src = (f: string) => readFileSync(join(r.path, f), 'utf8').split('\n')
  src('engine.ts').forEach((l, i) => {
    for (const m of l.matchAll(/this\.emit\('(\w+)',\s*\{([^}]*)\}/g)) {
      const keys = m[2]!.split(',').map((s) => s.split(':')[0]!.trim()).filter(Boolean)
      hooks.push({ kind: 'event', name: m[1]!, file: 'engine.ts', line: i + 1, detail: `{ ${keys.join(', ')} }` })
    }
  })
  let inApi = false
  src('modapi.ts').forEach((l, i) => {
    if (/export interface ModApi/.test(l)) inApi = true
    else if (inApi && /^\}/.test(l)) inApi = false
    else if (inApi) {
      const m = /^\s+(?:readonly\s+)?(\w+)(\(.*\)|:)\s*(.*)$/.exec(l)
      if (m) hooks.push({ kind: 'api', name: `api.${m[1]}`, file: 'modapi.ts', line: i + 1, detail: (m[2] === ':' ? m[3]! : `${m[2]}${m[3] ? ' ' + m[3] : ''}`).replace(/\s+/g, ' ').trim() })
    }
  })
  src('modloader.ts').forEach((l, i) => {
    const m = /cmd === '(\w+)'/.exec(l)
    if (m) for (const c of l.matchAll(/cmd === '(\w+)'/g)) hooks.push({ kind: 'console', name: c[1]!, file: 'modloader.ts', line: i + 1, detail: 'console.in command' })
  })
  // init is emitted by the loader once a mod's default export has run
  const ev = hooks.filter((h) => h.kind === 'event')
  return { hooks, note: `${ev.length} event hooks, ${hooks.length - ev.length - hooks.filter((h) => h.kind === 'console').length} API calls, ${hooks.filter((h) => h.kind === 'console').length} console commands` }
}

export function hooksMarkdown(r: Recon, hooks: Hook[]) {
  const rows = (k: Hook['kind']) => hooks.filter((h) => h.kind === k).map((h) => `| \`${h.name}\` | ${h.detail.replace(/\|/g, '\\|')} | ${h.file}:${h.line} |`).join('\n')
  return `# Hook points: ${r.name} (${r.engine})\n\nRead locally from the game's own source. Nothing here is redistributed.\n\n## Events (api.on)\n| hook | payload | site |\n|---|---|---|\n${rows('event')}\n\n## Mod API\n| call | signature | site |\n|---|---|---|\n${rows('api')}\n\n## Debug console (append to <profile>/console.in)\n| command | | site |\n|---|---|---|\n${rows('console')}\n`
}
