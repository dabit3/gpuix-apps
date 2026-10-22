import { existsSync, readFileSync, statSync } from 'node:fs'
import { designCodebase } from './code/design'
import { scanCodebase, type Codebase } from './code/scan'
import { design } from './designers'
import { parseSpec, validate, type Issue } from './spec/validate'
import type { MachineSpec } from './spec/types'

export class SpecError extends Error {
  constructor(public file: string, public issues: Issue[]) {
    super(`${file}: ${issues.length} issue${issues.length === 1 ? '' : 's'}\n${issues.slice(0, 12).map((i) => `  ${i.code.padEnd(14)} ${i.path}  ${i.message}`).join('\n')}`)
  }
}

export const isCodebaseDir = (arg: string) => existsSync(arg) && statSync(arg).isDirectory()
export const isSpecPath = (arg: string) => arg.endsWith('.json') || (existsSync(arg) && !isCodebaseDir(arg))

/** Read and validate a spec file. Throws SpecError listing every issue. */
export function readSpec(file: string): MachineSpec {
  const r = parseSpec(readFileSync(file, 'utf8'))
  if (!r.spec) throw new SpecError(file, r.issues)
  return r.spec
}

export interface CodeOptions { top?: number; hot?: Set<string> }

/** Scan a directory and build its machine. Returns the scan too so the watcher can redraw "hot" files without rescanning. */
export function loadCodebase(dir: string, opts: CodeOptions = {}, scan?: Codebase): { spec: MachineSpec; codebase: Codebase } {
  const codebase = scan ?? scanCodebase(dir, { top: opts.top })
  const spec = designCodebase(codebase, { hot: opts.hot })
  const issues = validate(JSON.parse(JSON.stringify(spec)))
  if (issues.length) throw new SpecError(`codebase ${dir}`, issues)
  return { spec, codebase }
}

/** Resolve a CLI argument: a source directory, an existing .json path, or a one-line description for the built-in designers. */
export function loadSource(arg: string, opts: CodeOptions = {}): { spec: MachineSpec; path?: string; dir?: string; codebase?: Codebase } {
  if (isCodebaseDir(arg)) return { ...loadCodebase(arg, opts), dir: arg }
  if (isSpecPath(arg)) return { spec: readSpec(arg), path: arg }
  const spec = design(arg)
  if (!spec) throw new Error(`No built-in designer for "${arg}". Ask your agent to write a spec with skill/SKILL.md, then run: anatomy <spec.json>`)
  const issues = validate(JSON.parse(JSON.stringify(spec)))
  if (issues.length) throw new SpecError(`designer "${arg}"`, issues)
  return { spec }
}
