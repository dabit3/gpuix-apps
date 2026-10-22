import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Browser } from '../src/browser'
import { findChrome, launchChrome, reapProfile, type ChromeProcess } from '../src/chrome'
import { imageSize } from '../src/frame'
import { mapPoint, viewportFor } from '../src/input'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = `<!doctype html><title>surf test</title>
<style>body{margin:0;font:16px sans-serif}#go{position:absolute;left:100px;top:80px;width:200px;height:60px}</style>
<button id="go" onclick="this.textContent='clicked '+(++window.n||(window.n=1));document.title='clicked'">click me</button>
<input id="field" style="position:absolute;left:100px;top:200px;width:200px">`

let server: ReturnType<typeof Bun.serve>
let chrome: ChromeProcess
let browser: Browser
const profile = mkdtempSync(join(tmpdir(), 'surf-it-'))

beforeAll(async () => {
  expect(findChrome()).not.toBeNull()
  server = Bun.serve({ port: 0, fetch: () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }) })
  const vp = viewportFor({ width: 640, height: 400 }, 1)
  chrome = await launchChrome({ profile, width: vp.width, height: vp.height })
  browser = await Browser.connect(chrome.wsUrl, { viewport: vp })
}, 30000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  chrome?.kill()
  reapProfile(profile)
  server?.stop(true)
})

const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(50) }
  return false
}

test('loads a local page, streams frames, and a click through the input path changes the page', async () => {
  await browser.navigate(`http://127.0.0.1:${server.port}/`)
  expect(await until(async () => (await browser.evaluate('document.readyState')) === 'complete')).toBe(true)
  expect(await until(() => browser.frames.hasPending)).toBe(true)
  const frame = browser.frames.take()!
  expect(imageSize(frame.bytes)).toEqual({ width: 640, height: 400, format: 'jpeg' })

  // A click where the button sits in a page box laid out at (12, 120) in window px.
  const box = { x: 12, y: 120, width: 640, height: 400 }
  const p = mapPoint(12 + 200, 120 + 110, box, browser.viewport)
  browser.mouse({ type: 'mouseMoved', x: p.x, y: p.y })
  browser.mouse({ type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  browser.mouse({ type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  expect(await until(async () => (await browser.evaluate("document.getElementById('go').textContent")) === 'clicked 1')).toBe(true)
  expect(await until(() => browser.active?.title === 'clicked')).toBe(true)
}, 30000)

test('typing reaches a focused input and the viewport follows a resize', async () => {
  const p = mapPoint(200, 210, { x: 0, y: 0, width: 640, height: 400 }, browser.viewport)
  browser.mouse({ type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  browser.mouse({ type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  expect(await until(async () => (await browser.evaluate('document.activeElement.id')) === 'field')).toBe(true)
  const { keyEvents } = await import('../src/input')
  for (const ch of 'Hi!') browser.keys(keyEvents({ key: ch, keyChar: ch })!)
  browser.insertText(' pasted')
  expect(await until(async () => (await browser.evaluate("document.getElementById('field').value")) === 'Hi! pasted')).toBe(true)

  await browser.setViewport(viewportFor({ width: 320, height: 300 }, 2))
  expect(await until(async () => (await browser.evaluate("innerWidth+'x'+innerHeight+'@'+devicePixelRatio")) === '320x300@2')).toBe(true)
  // Frames follow the new viewport's shape. Headless screencast may deliver them at CSS (320x300) or device (640x600) resolution.
  let size: ReturnType<typeof imageSize> = null
  expect(await until(() => { const f = browser.frames.take(); size = f ? imageSize(f.bytes) : size; return !!size && size.width * 300 === size.height * 320 })).toBe(true)
  expect([320, 640]).toContain(size!.width)
}, 30000)
