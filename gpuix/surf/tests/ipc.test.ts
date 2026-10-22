import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch, encode, instances, isRequest, LineReader, request, serve } from '../src/ipc'

const dir = mkdtempSync(join(tmpdir(), 'surf-ipc-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('wire format', () => {
  test('one JSON object per line', () => {
    expect(encode({ id: 1, cmd: 'open', args: ['https://example.com'] })).toBe('{"id":1,"cmd":"open","args":["https://example.com"]}\n')
  })
  test('LineReader joins partial chunks and skips junk lines', () => {
    const r = new LineReader()
    expect(r.push('{"id":1,"cm')).toEqual([])
    expect(r.push('d":"info","args":[]}\nnot json\n\n{"id":2')).toEqual([{ id: 1, cmd: 'info', args: [] }])
    expect(r.push(',"cmd":"tabs","args":[]}\n')).toEqual([{ id: 2, cmd: 'tabs', args: [] }])
  })
  test('isRequest validates shape', () => {
    expect(isRequest({ id: 1, cmd: 'eval', args: ['1+1'] })).toBe(true)
    expect(isRequest({ id: '1', cmd: 'eval', args: [] })).toBe(false)
    expect(isRequest({ id: 1, cmd: 'eval', args: [1] })).toBe(false)
    expect(isRequest(null)).toBe(false)
  })
  test('dispatch reports unknown commands and handler errors', async () => {
    const h = { ok: () => 42, boom: () => { throw new Error('nope') } }
    expect(await dispatch(h, { id: 3, cmd: 'ok', args: [] })).toEqual({ id: 3, ok: true, result: 42 })
    expect(await dispatch(h, { id: 4, cmd: 'boom', args: [] })).toEqual({ id: 4, ok: false, error: 'nope' })
    expect(await dispatch(h, { id: 5, cmd: 'zap', args: [] })).toEqual({ id: 5, ok: false, error: 'unknown command "zap"' })
  })
})

describe('unix socket round trip', () => {
  test('a client command reaches the running instance and gets its reply', async () => {
    const opened: string[] = []
    const srv = serve({ open: async (args) => { opened.push(args[0]!); return { tab: opened.length } }, eval: (args) => `evaluated ${args[0]}` }, join(dir, `${process.pid}.sock`))
    try {
      srv.touch({ url: 'https://news.ycombinator.com/', title: 'Hacker News' })
      expect(await request(srv.path, 'open', ['https://en.wikipedia.org'])).toEqual({ id: 1, ok: true, result: { tab: 1 } })
      expect(await request(srv.path, 'eval', ['document.title'])).toEqual({ id: 1, ok: true, result: 'evaluated document.title' })
      expect((await request(srv.path, 'nope', [])).ok).toBe(false)
      expect(opened).toEqual(['https://en.wikipedia.org'])
      const list = instances(dir)
      expect(list.map((i) => i.pid)).toEqual([process.pid])
      expect(list[0]).toMatchObject({ url: 'https://news.ycombinator.com/', title: 'Hacker News' })
    } finally {
      srv.stop()
    }
    expect(instances(dir)).toEqual([])
  })
  test('sockets left by dead processes are cleaned up', () => {
    const dead = 2 ** 22 - 3
    writeFileSync(join(dir, `${dead}.sock`), '')
    writeFileSync(join(dir, `${dead}.json`), '{}')
    expect(instances(dir)).toEqual([])
    expect(instances(join(dir, 'missing'))).toEqual([])
  })
})
