import { join } from 'node:path'
import type { Controller } from './controller'

/** E in the live app: run `morph --export` as a child process (the offscreen test renderer) and stream its progress. */
export function spawnExport(c: Controller, theme?: string) {
  if (c.exp.status === 'running') return
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  const out = join(process.cwd(), 'out', `morph-${c.palette}${c.aspect === 'vertical' ? '-4x5' : ''}-${stamp}.mp4`)
  c.exp = { status: 'running', done: 0, total: 840, out, message: '' }
  c.onChange?.()
  const args = [process.execPath, join(import.meta.dir, 'cli.ts'), '--export', out, '--progress', '--palette', c.palette, ...(c.aspect === 'vertical' ? ['--vertical'] : []), ...(theme ? ['--theme', theme] : [])]
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, RUST_LOG: 'error' } })
  ;(async () => {
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of child.stdout) {
      buf += dec.decode(chunk)
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        const m = /^progress (\d+)\/(\d+)/.exec(line)
        if (m) { c.exp.done = Number(m[1]); c.exp.total = Number(m[2]) }
      }
    }
    const code = await child.exited
    c.exp.status = code === 0 ? 'done' : 'error'
    c.exp.done = c.exp.total
    if (code !== 0) c.exp.message = (await new Response(child.stderr).text()).trim().split('\n').pop() ?? ''
    c.onChange?.()
  })()
}
