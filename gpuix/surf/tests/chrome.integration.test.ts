import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Browser } from '../src/browser'
import { chromeArgs, findChrome, launchChrome, reapProfile, type ChromeProcess } from '../src/chrome'
import { imageSize } from '../src/frame'
import { mapPoint, rasterScale, viewportFor } from '../src/input'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = `<!doctype html><title>surf test</title>
<style>body{margin:0;font:16px sans-serif}#go{position:absolute;left:100px;top:80px;width:200px;height:60px}</style>
<button id="go" onclick="this.textContent='clicked '+(++window.n||(window.n=1));document.title='clicked'">click me</button>
<input id="field" style="position:absolute;left:100px;top:200px;width:200px">`

const LONG = `<!doctype html><title>long</title><nav style="display:none">needle in a hidden menu</nav>
<div style="height:3000px">top</div><p id="hit">the visible needle</p><div style="height:2000px"></div>`

let server: ReturnType<typeof Bun.serve>
let chrome: ChromeProcess
let browser: Browser
const profile = mkdtempSync(join(tmpdir(), 'surf-it-'))

beforeAll(async () => {
  expect(findChrome()).not.toBeNull()
  server = Bun.serve({ port: 0, fetch: (req) => new Response(new URL(req.url).pathname === '/long' ? LONG : PAGE, { headers: { 'content-type': 'text/html' } }) })
  const vp = viewportFor({ width: 640, height: 400 }, 1)
  chrome = await launchChrome({ profile, width: vp.width, height: vp.height, scale: rasterScale(1) })
  browser = await Browser.connect(chrome.cdp, { viewport: vp, rasterScale: rasterScale(1) })
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

test('CDP runs over --remote-debugging-pipe: no debugging port, profile readable only by us', async () => {
  const args = chromeArgs(profile, { width: 640, height: 400 })
  expect(args).toContain('--remote-debugging-pipe')
  expect(args.some((a) => a.startsWith('--remote-debugging-port') || a.startsWith('--remote-debugging-address'))).toBe(false)
  expect(existsSync(join(profile, 'DevToolsActivePort'))).toBe(false)
  expect(statSync(profile).mode & 0o777).toBe(0o700)
  expect(chrome.version).toContain('Chrome')
})

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
  expect(await until(async () => (await browser.evaluate("innerWidth+'x'+innerHeight+'@'+Math.round(devicePixelRatio*1e3)/1e3")) === '320x300@2')).toBe(true)
  // Frames follow the new viewport's shape. Headless screencast may deliver them at CSS (320x300) or device (640x600) resolution.
  let size: ReturnType<typeof imageSize> = null
  expect(await until(() => { const f = browser.frames.take(); size = f ? imageSize(f.bytes) : size; return !!size && size.width * 300 === size.height * 320 })).toBe(true)
  expect([320, 640]).toContain(size!.width)
}, 30000)

test('find skips hidden text and scrolls the match into view', async () => {
  await browser.navigate(`http://localhost:${server.port}/long`)
  expect(await until(async () => (await browser.evaluate('document.readyState+location.pathname')) === 'complete/long')).toBe(true)
  expect(await browser.evaluate('scrollY')).toBe(0)
  const r = await browser.find('needle', { fromStart: true })
  expect(r).toEqual({ count: 1, found: true, index: 1 })
  expect(await browser.evaluate("String(CSS.highlights.get('surf-find-current').values().next().value)")).toBe('needle')
  expect(await browser.evaluate('scrollY')).toBeGreaterThan(2500)
  expect(await browser.evaluate("CSS.highlights.get('surf-find-current').size")).toBe(1)
  expect(await browser.find('needle')).toEqual({ count: 1, found: true, index: 1 })
  expect(await browser.find('nothing-here', { fromStart: true })).toEqual({ count: 0, found: false, index: 0 })
}, 30000)

test('frames keep the viewport aspect after opening a tab and switching back', async () => {
  const first = browser.activeId
  await browser.navigate(`http://127.0.0.1:${server.port}/`)
  await browser.newTab('about:blank')
  await browser.activate(first)
  expect(browser.activeId).toBe(first)
  await browser.evaluate("setInterval(() => document.body.style.background = document.body.style.background === 'white' ? 'ivory' : 'white', 50)")
  const want = browser.viewport.width / browser.viewport.height
  let got = 0
  expect(await until(async () => {
    browser.frames.take()
    await Bun.sleep(200)
    const f = browser.frames.take()
    if (!f) return false
    got = f.width / f.height
    return Math.abs(got - want) / want < 0.01
  })).toBe(true)
}, 30000)

test('overlapping resizes settle on the last requested viewport, even one Chrome already had', async () => {
  const start = browser.viewport
  const sizes = [{ width: 900, height: 500 }, { width: 520, height: 360 }, { width: 760, height: 430 }, { width: start.width, height: start.height }, { width: 610, height: 390 }]
  await Promise.all(sizes.map((s) => browser.setViewport(viewportFor(s, 1))))
  const last = sizes[sizes.length - 1]!
  expect(browser.viewport.width).toBe(last.width)
  expect(await browser.evaluate('innerWidth + "x" + innerHeight')).toBe(`${last.width}x${last.height}`)
  // A → B → A while B is still applying must end at A, not B
  const a = viewportFor({ width: 700, height: 420 }, 1), b = viewportFor({ width: 480, height: 320 }, 1)
  await browser.setViewport(a)
  const pb = browser.setViewport(b)
  const pa = browser.setViewport(a)
  await Promise.all([pb, pa])
  expect(await browser.evaluate('innerWidth + "x" + innerHeight')).toBe('700x420')
  await browser.evaluate("setInterval(() => document.body.style.background = document.body.style.background === 'white' ? 'ivory' : 'white', 50)")
  expect(await until(async () => {
    browser.frames.take()
    await Bun.sleep(150)
    const f = browser.frames.take()
    return !!f && f.cssWidth === 700 && f.cssHeight === 420
  })).toBe(true)
}, 30000)

test('page zoom re-lays the page out, frames keep the pane size, and clicks land on the zoomed page', async () => {
  await browser.setViewport(viewportFor({ width: 640, height: 400 }, 1))
  await browser.navigate(`http://127.0.0.1:${server.port}/`)
  expect(await until(async () => (await browser.evaluate('document.readyState')) === 'complete')).toBe(true)
  expect(await browser.setZoom(2)).toBe(2)
  expect(browser.active?.zoom).toBe(2)
  expect(await browser.evaluate('innerWidth + "x" + innerHeight + "@" + Math.round(devicePixelRatio * 1e3) / 1e3')).toBe('320x200@2')
  await browser.evaluate("setInterval(() => document.body.style.background = document.body.style.background === 'white' ? 'ivory' : 'white', 50)")
  let f: ReturnType<typeof browser.frames.take> = null
  expect(await until(async () => {
    browser.frames.take()
    await Bun.sleep(150)
    f = browser.frames.take()
    return !!f && f.cssWidth === 320
  })).toBe(true)
  // a device-pixel frame (crisp, rendered at the raster scale), not a 320 px CSS-size frame
  expect(f!.width).toBe(640)
  expect(f!.zoom).toBe(2)
  // #go is at CSS (100,80) 200x60, so on screen at 2x it spans (200,160)-(600,280) of the pane
  const box = { x: 12, y: 120, width: f!.cssWidth * f!.zoom, height: f!.cssHeight * f!.zoom }
  const p = mapPoint(12 + 400, 120 + 220, box, { width: f!.cssWidth, height: f!.cssHeight })
  expect(p).toEqual({ x: 200, y: 110 })
  const before = Number(String(await browser.evaluate("document.getElementById('go').textContent")).replace(/\D/g, '') || 0)
  browser.mouse({ type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  browser.mouse({ type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  expect(await until(async () => (await browser.evaluate("document.getElementById('go').textContent")) === `clicked ${before + 1}`)).toBe(true)
  // zoom is per tab: a new tab starts at 100%, and the zoomed tab keeps 200%
  // a zoomed tab keeps painting after it navigates away mid-capture
  await browser.evaluate("let h = 0; setInterval(() => { document.body.style.background = 'hsl(' + (h += 7) + ',60%,50%)' }, 16)")
  await Bun.sleep(400)
  await browser.evaluate(`location.href = 'http://localhost:${server.port}/long'`)
  expect(await until(async () => (await browser.evaluate('document.readyState+location.pathname')) === 'complete/long')).toBe(true)
  await Bun.sleep(300)
  browser.frames.take()
  await browser.evaluate("document.body.style.background = 'rgb(255, 0, 0)'")
  expect(await until(async () => !!browser.frames.take())).toBe(true)
  const zoomed = browser.activeId
  await browser.newTab('about:blank')
  expect(browser.active?.zoom).toBe(1)
  expect(await browser.evaluate('innerWidth')).toBe(640)
  await browser.closeTab()
  await browser.activate(zoomed)
  expect(await browser.evaluate('innerWidth')).toBe(320)
  expect(await browser.setZoom(0.5)).toBe(0.5)
  expect(await until(async () => (await browser.evaluate('innerWidth + "@" + Math.round(devicePixelRatio * 1e3) / 1e3')) === '1280@0.5')).toBe(true)
  // rapid steps while zoomed-in captures are running: the last one wins
  await Promise.all([1.1, 1.25, 1.5, 1.75].map((z) => browser.setZoom(z)))
  await Bun.sleep(300)
  expect(await browser.evaluate('innerWidth + "@" + Math.round(devicePixelRatio * 1e3) / 1e3')).toBe('366@1.75')
  expect(await browser.setZoom(1)).toBe(1)
  expect(await until(async () => (await browser.evaluate('innerWidth + "@" + Math.round(devicePixelRatio * 1e3) / 1e3')) === '640@1')).toBe(true)
}, 30000)

test('wheel bursts coalesce into a smooth scroll that lands on the full distance', async () => {
  await browser.setZoom(1)
  await browser.navigate(`http://127.0.0.1:${server.port}/long`)
  expect(await until(async () => (await browser.evaluate('document.readyState+location.pathname')) === 'complete/long')).toBe(true)
  await browser.evaluate("window.ticks = 0; addEventListener('wheel', () => window.ticks++)")
  for (let i = 0; i < 10; i++) browser.wheel(200, 200, 0, 40)
  expect(browser.scrolling).toBe(true)
  expect(await until(async () => !browser.scrolling && (await browser.evaluate('scrollY')) === 400)).toBe(true)
  // ten line jumps become a glide of several smaller wheel events
  expect(Number(await browser.evaluate('window.ticks'))).toBeGreaterThan(3)
}, 30000)

test('zooming keeps the content at the middle of the viewport in place', async () => {
  await browser.evaluate("scrollTo(0, 0); document.getElementById('hit').scrollIntoView({ block: 'center' })")
  const mid = async () => Number(await browser.evaluate("(() => { const r = document.getElementById('hit').getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight })()"))
  expect(Math.abs((await mid()) - 0.5)).toBeLessThan(0.05)
  await browser.setZoom(2)
  expect(Math.abs((await mid()) - 0.5)).toBeLessThan(0.08)
  await browser.setZoom(1)
  expect(Math.abs((await mid()) - 0.5)).toBeLessThan(0.08)
}, 30000)
