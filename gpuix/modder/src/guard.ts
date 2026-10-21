// Every file modder writes goes through here. Writing inside the original game directory
// is refused unless the caller passed --yes; everything else lands in the workspace.
import { cpSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, isAbsolute } from 'node:path'

export class GuardError extends Error { constructor(public target: string, public gameDir: string) { super(`refusing to write into the original game directory without --yes: ${target}`) } }
export interface GuardCtx { gameDir: string; yes: boolean; written?: string[] }

const real = (p: string): string => {
  let cur = resolve(p)
  const tail: string[] = []
  while (!existsSync(cur)) { const up = dirname(cur); if (up === cur) break; tail.unshift(cur.slice(up.length + 1)); cur = up }
  return resolve(realpathSync(cur), ...tail)
}

export function isInside(child: string, parent: string) {
  const rel = relative(real(parent), real(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export function guard(target: string, ctx: GuardCtx) {
  if (isInside(target, ctx.gameDir) && !ctx.yes) throw new GuardError(target, ctx.gameDir)
  ctx.written?.push(target)
}
export function safeMkdir(dir: string, ctx: GuardCtx) { guard(dir, ctx); mkdirSync(dir, { recursive: true }) }
export function safeWrite(file: string, data: string | Uint8Array, ctx: GuardCtx) { guard(file, ctx); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data) }
export function safeCopy(src: string, dst: string, ctx: GuardCtx) { guard(dst, ctx); cpSync(src, dst, { recursive: true }) }
