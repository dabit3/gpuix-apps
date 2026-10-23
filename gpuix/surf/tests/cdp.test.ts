import { expect, test } from 'bun:test'
import { Cdp, pipeTransport } from '../src/cdp'

// A stand-in for Chrome's pipe end: answers each NUL-terminated request on fd 3 with a response (in two writes) and an event on fd 4.
const FAKE_CHROME = `
const fs = require('node:fs')
let buf = ''
const out = (s) => fs.writeSync(4, s)
fs.createReadStream(null, { fd: 3 }).on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    const res = JSON.stringify({ id: msg.id, result: { echo: msg.method, big: 'é'.repeat(100000) } })
    out(res.slice(0, 7)); out(res.slice(7) + '\\0' + JSON.stringify({ method: 'Fake.event', params: { n: msg.id } }) + '\\0')
  }
}).on('end', () => process.exit(0))
`

test('pipe transport frames NUL-delimited messages split across writes, and closes when the peer exits', async () => {
  const proc = Bun.spawn([process.execPath, '-e', FAKE_CHROME], { stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'] })
  const cdp = new Cdp(pipeTransport(proc.stdio[3] as number, proc.stdio[4] as number))
  const events: number[] = []
  cdp.on('Fake.event', (p) => events.push(p.n))
  const [a, b] = await Promise.all([cdp.send('Browser.getVersion'), cdp.send('Target.getTargets')])
  expect(a.echo).toBe('Browser.getVersion')
  expect(b.echo).toBe('Target.getTargets')
  expect(a.big).toBe('é'.repeat(100000))
  expect(events.sort()).toEqual([1, 2])
  const closed = new Promise((r) => cdp.on('close', r))
  cdp.close()
  await closed
  expect(cdp.closed).toBe(true)
  await expect(cdp.send('Browser.getVersion')).rejects.toThrow('connection closed')
  expect(await proc.exited).toBe(0)
})
