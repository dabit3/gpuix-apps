import { existsSync, readFileSync } from 'node:fs'
import { design } from './designers'
import { parseSpec, validate, type Issue } from './spec/validate'
import type { MachineSpec } from './spec/types'

export class SpecError extends Error {
  constructor(public file: string, public issues: Issue[]) {
    super(`${file}: ${issues.length} issue${issues.length === 1 ? '' : 's'}\n${issues.slice(0, 12).map((i) => `  ${i.code.padEnd(14)} ${i.path}  ${i.message}`).join('\n')}`)
  }
}

export const isSpecPath = (arg: string) => arg.endsWith('.json') || existsSync(arg)

/** Read and validate a spec file. Throws SpecError listing every issue. */
export function readSpec(file: string): MachineSpec {
  const r = parseSpec(readFileSync(file, 'utf8'))
  if (!r.spec) throw new SpecError(file, r.issues)
  return r.spec
}

/** Resolve a CLI argument: an existing .json path, or a one-line description handled by the built-in designers. */
export function loadSource(arg: string): { spec: MachineSpec; path?: string } {
  if (isSpecPath(arg)) return { spec: readSpec(arg), path: arg }
  const spec = design(arg)
  if (!spec) throw new Error(`No built-in designer for "${arg}". Ask your agent to write a spec with skill/SKILL.md, then run: anatomy <spec.json>`)
  const issues = validate(JSON.parse(JSON.stringify(spec)))
  if (issues.length) throw new SpecError(`designer "${arg}"`, issues)
  return { spec }
}
