import { render } from '@gpuix/react'
import { SqDb } from './db'
import { SqApp, windowHandlers } from './app'

const argv = process.argv.slice(2).filter((a) => !a.endsWith('main.tsx'))
let path = ''
let initialSql = ''
let windowMode = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  if (a === '-e' || a === '--execute') initialSql = argv[++i] ?? ''
  else if (a === '-w' || a === '--window') windowMode = true
  else if (!path) path = a
}
if (!path) {
  console.error('usage: sq <file.db>')
  process.exit(1)
}
const quiet = console.log
console.log = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return
  quiet(...a)
}
const db = new SqDb(path)
render(<SqApp db={db} initialSql={initialSql} />, {
  title: `sq · ${path.split('/').pop()}`,
  width: 1440,
  height: 900,
  terminal: !windowMode,
  titlebarTransparent: true,
  trafficLightX: 16,
  trafficLightY: 17,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown: (e) => windowHandlers.onKeyDown?.(e),
})
