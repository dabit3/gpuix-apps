export type Vars = Record<string, string>

/** Resolves `{{name}}` from the active environment; a value of `$NAME` reads the process env. */
export function resolveValue(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.startsWith('$') ? (env[value.slice(1)] ?? '') : value
}

export function interpolate(text: string, vars: Vars, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
    name in vars ? resolveValue(vars[name]!, env) : match,
  )
}

export function missingVars(text: string, vars: Vars): string[] {
  return [...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!).filter((n) => !(n in vars))
}

export const isSecret = (name: string, value: string) => value.startsWith('$') || /token|secret|key|password/i.test(name)
