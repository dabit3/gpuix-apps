import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { Cdp, pipeTransport } from './cdp'

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

/** `scale` is the browser's device scale factor: screencast frames are rendered at CSS px × scale, so zoomed-in pages stream crisp. */
export function chromeArgs(profile: string, size: { width: number; height: number }, scale = 1) {
  return [
    ...(scale !== 1 ? [`--force-device-scale-factor=${scale}`] : []),
    '--headless',
    '--remote-debugging-pipe',
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

export interface ChromeProcess { proc: Subprocess; cdp: Cdp; profile: string; version: string; kill(): void }

export const defaultProfile = () => join(homedir(), '.surf', 'profiles', String(process.pid))

/** Creates `dir` (and missing parents) readable only by this user, tightening an existing one. */
export function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

/** Starts headless Chrome and resolves with a CDP client on its `--remote-debugging-pipe` (fds 3/4); no debugging port is opened. */
export async function launchChrome(opts: { executable?: string; profile?: string; width?: number; height?: number; timeoutMs?: number; args?: string[]; scale?: number } = {}): Promise<ChromeProcess> {
  const exe = opts.executable ?? findChrome()
  if (!exe) throw new Error('Chrome not found. Install Google Chrome or set SURF_CHROME=/path/to/chrome')
  const profile = opts.profile ?? defaultProfile()
  ensurePrivateDir(profile)
  const args = (opts.args ?? []).filter((a) => !/^--remote-debugging-(port|address)\b/.test(a))
  const proc = Bun.spawn([exe, ...chromeArgs(profile, { width: opts.width ?? 1280, height: opts.height ?? 800 }, opts.scale), ...args], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  const kill = () => { try { proc.kill('SIGKILL') } catch {} }
  let stderr = ''
  // keep draining stderr so Chrome never blocks on a full pipe; the tail explains a failed start
  void (async () => {
    const dec = new TextDecoder()
    try { for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) stderr = (stderr + dec.decode(chunk, { stream: true })).slice(-4000) } catch {}
  })()
  const cdp = new Cdp(pipeTransport(proc.stdio[3] as number, proc.stdio[4] as number))
  const timeoutMs = opts.timeoutMs ?? 15000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const v = await Promise.race([
      cdp.send<{ product?: string }>('Browser.getVersion'),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), timeoutMs) }),
    ])
    return { proc, cdp, profile, version: v.product ?? 'Chrome', kill }
  } catch (e) {
    kill()
    cdp.close()
    await Promise.race([proc.exited, Bun.sleep(500)])
    const tail = stderr.trim().split('\n').slice(-3).join(' ')
    throw new Error(`Chrome did not start: ${tail || (e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
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
