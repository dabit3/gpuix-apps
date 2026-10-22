import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Subprocess } from 'bun'

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/** $SURF_CHROME, then the usual install locations. */
export function findChrome(env = process.env): string | null {
  if (env.SURF_CHROME) return existsSync(env.SURF_CHROME) ? env.SURF_CHROME : null
  return CANDIDATES.find((p) => existsSync(p)) ?? null
}

export function chromeArgs(profile: string, size: { width: number; height: number }) {
  return [
    '--headless',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${Math.max(200, size.width)},${Math.max(200, size.height)}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ]
}

export interface ChromeProcess { proc: Subprocess; wsUrl: string; profile: string; version: string; kill(): void }

export const defaultProfile = () => join(homedir(), '.surf', 'profiles', String(process.pid))

/** Starts headless Chrome and resolves with its browser WebSocket endpoint. */
export async function launchChrome(opts: { executable?: string; profile?: string; width?: number; height?: number; timeoutMs?: number } = {}): Promise<ChromeProcess> {
  const exe = opts.executable ?? findChrome()
  if (!exe) throw new Error('Chrome not found. Install Google Chrome or set SURF_CHROME=/path/to/chrome')
  const profile = opts.profile ?? defaultProfile()
  mkdirSync(profile, { recursive: true })
  const proc = Bun.spawn([exe, ...chromeArgs(profile, { width: opts.width ?? 1280, height: opts.height ?? 800 })], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
  const kill = () => { try { proc.kill('SIGKILL') } catch {} }
  const reader = proc.stderr.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + (opts.timeoutMs ?? 15000)
  try {
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => ({ value: undefined, done: true }))])
      if (done) break
      buf += dec.decode(value)
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
      if (m) {
        // keep draining stderr so Chrome never blocks on a full pipe
        void (async () => { try { while (!(await reader.read()).done) {} } catch {} })()
        const res = await fetch(m[1]!.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '/json/version')).then((r) => r.json()).catch(() => ({})) as { Browser?: string }
        return { proc, wsUrl: m[1]!, profile, version: res.Browser ?? 'Chrome', kill }
      }
    }
  } catch (e) { kill(); throw e }
  kill()
  throw new Error(`Chrome did not start: ${buf.trim().split('\n').slice(-3).join(' ') || 'timed out'}`)
}

export function removeProfile(dir: string) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

/** Kills any Chrome still using `profile` (a crashed or force-quit surf) and removes the profile directory. */
export function reapProfile(profile: string) {
  try {
    const ps = Bun.spawnSync(['ps', '-axo', 'pid=,command=']).stdout.toString()
    for (const line of ps.split('\n')) {
      if (!line.includes(`--user-data-dir=${profile}`)) continue
      const pid = Number(line.trim().split(/\s+/)[0])
      if (pid && pid !== process.pid) try { process.kill(pid, 'SIGKILL') } catch {}
    }
  } catch {}
  removeProfile(profile)
}
