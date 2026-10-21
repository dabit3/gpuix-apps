import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import type { Streamer } from './src/anthropic'
import { ClaudeDesk } from './src/ClaudeDesk'
import { emptyStore, saveStore, type StoreData, type Thread } from './src/store'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const REPLY = [
  'Here is the comparison.\n\n',
  '| Runtime | Startup | TypeScript |\n',
  '|---|---|---|\n',
  '| Bun | 6 ms | Native |\n',
  '| Node.js | 40 ms | Strip types |\n\n',
  '```ts\nconst cache = new Map<string, number>()\n```\n\n',
  '```diff\n--- a/fetch.ts\n+++ b/fetch.ts\n@@ -1,2 +1,2 @@\n-const retries = 0\n+const retries = 3\n```\n',
  'Done.',
]

/** Streams REPLY in chunks like the Messages API, and honours the abort signal. */
function mockStreamer(delayMs = 4): Streamer {
  return async (request, callbacks) => {
    callbacks.onUsage?.({ inputTokens: 120 })
    for (const chunk of REPLY) {
      if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await new Promise((r) => setTimeout(r, delayMs))
      callbacks.onText(chunk)
    }
    return { inputTokens: 120, outputTokens: 64, stopReason: 'end_turn' }
  }
}

/** Sends one token, then waits until the user presses Stop. */
const hangingStreamer: Streamer = (request, callbacks) =>
  new Promise((_, reject) => {
    callbacks.onText('Let me think about ')
    request.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })

const dirs: string[] = []
function tempStore(seed?: StoreData): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desk-'))
  dirs.push(dir)
  const file = path.join(dir, 'threads.json')
  if (seed) saveStore(file, seed)
  return file
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const readStore = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as StoreData

function thread(id: string, title: string, messages: Thread['messages'] = []): Thread {
  return { id, title, createdAt: 1, updatedAt: Date.now(), messages }
}

async function until(check: () => boolean, label: string, timeoutMs = 5000) {
  const start = Date.now()
  const ok = () => {
    try {
      return check()
    } catch {
      return false
    }
  }
  while (!ok()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

describeNative('Claude Desk', () => {
  it('sends with Enter, streams a markdown + diff reply, and persists the thread', async () => {
    const file = tempStore()
    const { render, renderer } = createTestRoot()
    render(<ClaudeDesk storePath={file} streamer={mockStreamer()} />)
    const app = await connectTest(renderer)
    try {
      const composer = app.getByTestId('composer')
      await composer.fill('Compare Bun and Node')
      await composer.press('enter')

      await app.getByTestId('reply-meta').waitFor({ timeoutMs: 10_000 })
      const painted = renderer.getPaintedText().join('\n')
      expect(painted).toContain('Compare Bun and Node')
      expect(painted).toContain('Strip types')
      expect(renderer.findByType('diff')).toHaveLength(1)
      expect(await app.getByTestId('message-count').textContent()).toBe('2 messages')
      expect(await app.getByTestId('reply-meta').textContent()).toContain('120 in · 64 out')
      expect(await app.getByTestId('thread-title-0').textContent()).toBe('Compare Bun and Node')

      await until(() => readStore(file).threads[0]?.messages.length === 2 && !!readStore(file).threads[0]?.messages[1]?.meta, 'persisted reply')
      const saved = readStore(file)
      expect(saved.threads).toHaveLength(1)
      expect(saved.threads[0]!.messages[0]!.content).toBe('Compare Bun and Node')
      expect(saved.threads[0]!.messages[1]!.content).toBe(REPLY.join(''))
      expect(saved.threads[0]!.messages[1]!.meta).toMatchObject({ model: 'claude-sonnet-5-5', outputTokens: 64, stopReason: 'end_turn' })
    } finally {
      await app.close()
    }
  })

  it('stops a streaming reply and keeps the partial text', async () => {
    const file = tempStore()
    const { render, renderer } = createTestRoot()
    render(<ClaudeDesk storePath={file} streamer={hangingStreamer} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('composer').fill('Plan a migration')
      await app.getByTestId('composer').press('enter')
      await app.getByTestId('stop').waitFor()
      await app.getByTestId('stop').click()
      await app.getByTestId('send').waitFor()
      expect(await app.getByTestId('reply-meta').textContent()).toContain('Stopped')
      await until(() => readStore(file).threads[0]?.messages[1]?.meta?.stopReason === 'stopped', 'stopped reply saved')
      expect(readStore(file).threads[0]!.messages[1]!.content).toBe('Let me think about ')
    } finally {
      await app.close()
    }
  })

  it('renames and deletes threads, persisting both', async () => {
    const seed = { ...emptyStore(), activeId: 'a', threads: [thread('a', 'Bun vs Node'), thread('b', 'LRU cache')] }
    const file = tempStore(seed)
    const { render, renderer } = createTestRoot()
    render(<ClaudeDesk storePath={file} streamer={mockStreamer()} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('rename-0').click()
      const input = app.getByTestId('rename-input-0')
      await input.fill('Runtime shootout')
      await input.press('enter')
      expect(await app.getByTestId('thread-title-0').textContent()).toBe('Runtime shootout')
      await until(() => readStore(file).threads[0]?.title === 'Runtime shootout', 'renamed thread saved')

      await app.getByTestId('delete-0').click()
      expect(await app.getByTestId('thread-title-0').textContent()).toBe('LRU cache')
      await until(() => readStore(file).threads.length === 1, 'deleted thread saved')
      expect(readStore(file).activeId).toBe('b')
    } finally {
      await app.close()
    }
  })

  it('finds matches across messages and steps through them', async () => {
    const seed = {
      ...emptyStore(),
      activeId: 'a',
      threads: [
        thread('a', 'Caching', [
          { id: 'm1', role: 'user', content: 'How should I cache API calls?' },
          { id: 'm2', role: 'assistant', content: 'Use an LRU cache.\n\nA cache with a TTL also works.' },
        ]),
      ],
    } satisfies StoreData
    const { render, renderer } = createTestRoot()
    render(<ClaudeDesk storePath={tempStore(seed)} streamer={mockStreamer()} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('find-toggle').click()
      await app.getByTestId('find-input').fill('cache')
      expect(await app.getByTestId('find-count').textContent()).toBe('1 of 3')
      await app.getByTestId('find-next').click()
      expect(await app.getByTestId('find-count').textContent()).toBe('2 of 3')
      const highlights = renderer.getPaintedHighlights()
      expect(highlights.length).toBe(3)
      expect(highlights.filter((h) => h.active)).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('switches model through the Select and saves a system prompt from the Dialog', async () => {
    const file = tempStore()
    const { render, renderer } = createTestRoot()
    render(<ClaudeDesk storePath={file} streamer={mockStreamer()} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('model-picker').click()
      await app.getByTestId('model-claude-haiku-5-5').click()
      expect(await app.getByTestId('model-label').textContent()).toBe('Claude Haiku 5.5')

      await app.getByTestId('open-settings').click()
      await app.getByTestId('system-prompt').fill('Answer like a pirate.')
      await app.getByTestId('save-settings').click()
      await until(() => readStore(file).settings.systemPrompt === 'Answer like a pirate.', 'system prompt saved')
      expect(readStore(file).settings.model).toBe('claude-haiku-5-5')
    } finally {
      await app.close()
    }
  })
})
