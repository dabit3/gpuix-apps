import { describe, expect, test } from 'bun:test'
import { cdpButton, cdpButtons, cdpModifiers, keyEvents, mapPoint, printable, viewportFor, wheelDelta } from '../src/input'

describe('mapPoint', () => {
  const box = { x: 12, y: 120, width: 700, height: 400 }
  test('maps window px onto page CSS px 1:1 when the viewport matches the box', () => {
    expect(mapPoint(12, 120, box, { width: 700, height: 400 })).toEqual({ x: 0, y: 0 })
    expect(mapPoint(362, 320, box, { width: 700, height: 400 })).toEqual({ x: 350, y: 200 })
  })
  test('scales when Chrome has not caught up with a resize yet', () => {
    expect(mapPoint(362, 320, box, { width: 1400, height: 800 })).toEqual({ x: 700, y: 400 })
  })
  test('clamps points outside the page to its edge', () => {
    expect(mapPoint(0, 0, box, { width: 700, height: 400 })).toEqual({ x: 0, y: 0 })
    expect(mapPoint(5000, 5000, box, { width: 700, height: 400 })).toEqual({ x: 699, y: 399 })
  })
})

describe('viewportFor (DPR)', () => {
  test('keeps CSS size and multiplies frame size by the pixel ratio', () => {
    expect(viewportFor({ width: 693.6, height: 738.2 }, 2)).toEqual({ width: 693, height: 738, deviceScaleFactor: 2, frameWidth: 1386, frameHeight: 1476 })
  })
  test('1x terminal gets a 1:1 frame', () => {
    expect(viewportFor({ width: 1413, height: 738 }, 1)).toEqual({ width: 1413, height: 738, deviceScaleFactor: 1, frameWidth: 1413, frameHeight: 738 })
  })
  test('rejects bogus ratios and caps at 3x', () => {
    expect(viewportFor({ width: 100, height: 50 }, 0).deviceScaleFactor).toBe(1)
    expect(viewportFor({ width: 100, height: 50 }, Number.NaN).deviceScaleFactor).toBe(1)
    expect(viewportFor({ width: 100, height: 50 }, 8).deviceScaleFactor).toBe(3)
    expect(viewportFor({ width: 0, height: 0 }, 1)).toMatchObject({ width: 1, height: 1 })
  })
})

describe('mouse buttons and modifiers', () => {
  test('button 0 is the left button, not "none"', () => {
    expect(cdpButton(0)).toBe('left')
    expect(cdpButton(1)).toBe('middle')
    expect(cdpButton(2)).toBe('right')
    expect(cdpButton(undefined)).toBe('none')
    expect(cdpButtons(0)).toBe(1)
    expect(cdpButtons(2)).toBe(2)
    expect(cdpButtons(null)).toBe(0)
  })
  test('modifier bitmask follows CDP (Alt=1 Ctrl=2 Meta=4 Shift=8)', () => {
    expect(cdpModifiers({ alt: true, ctrl: true, cmd: true, shift: true })).toBe(15)
    expect(cdpModifiers({ shift: true })).toBe(8)
    expect(cdpModifiers()).toBe(0)
  })
  test('wheel deltas flip sign and scale line deltas', () => {
    expect(wheelDelta(0, -3, false)).toEqual({ deltaX: -0, deltaY: 120 })
    expect(wheelDelta(2, 15, true)).toEqual({ deltaX: -2, deltaY: -15 })
  })
})

describe('key mapping', () => {
  test('terminal "space" key with a letter in keyChar types the letter', () => {
    expect(printable({ key: 'space', keyChar: 'q' })).toBe('q')
    expect(printable({ key: 'space', keyChar: ' ' })).toBe(' ')
    expect(printable({ key: 'a', modifiers: { shift: true } })).toBe('A')
    expect(printable({ key: 'enter' })).toBeNull()
  })
  test('a letter becomes keyDown with text + keyUp', () => {
    const evs = keyEvents({ key: 'space', keyChar: 'G', modifiers: { shift: true } })!
    expect(evs).toHaveLength(2)
    expect(evs[0]).toMatchObject({ type: 'keyDown', key: 'G', code: 'KeyG', windowsVirtualKeyCode: 71, text: 'G', modifiers: 8 })
    expect(evs[1]).toMatchObject({ type: 'keyUp', key: 'G', code: 'KeyG' })
  })
  test('special keys are rawKeyDown without text', () => {
    expect(keyEvents({ key: 'backspace' })![0]).toMatchObject({ type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 })
    expect(keyEvents({ key: 'left' })![0]).toMatchObject({ key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
    expect(keyEvents({ key: 'f5' })![0]).toMatchObject({ key: 'F5', windowsVirtualKeyCode: 116 })
    expect(keyEvents({ key: 'enter' })![0]).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r' })
  })
  test('punctuation and shifted digits carry the right physical code', () => {
    expect(keyEvents({ key: '!', keyChar: '!' })![0]).toMatchObject({ key: '!', code: 'Digit1', text: '!' })
    expect(keyEvents({ key: '/', keyChar: '/' })![0]).toMatchObject({ code: 'Slash', windowsVirtualKeyCode: 191 })
  })
  test('Ctrl+letter sends no text and maps editing shortcuts to commands', () => {
    const a = keyEvents({ key: 'a', modifiers: { ctrl: true } })![0]!
    expect(a.type).toBe('rawKeyDown')
    expect(a.text).toBeUndefined()
    expect(a.commands).toEqual(['selectAll'])
    expect(keyEvents({ key: 'z', modifiers: { ctrl: true, shift: true } })![0]!.commands).toEqual(['redo'])
  })
  test('keys with no page meaning are dropped', () => {
    expect(keyEvents({ key: 'shift' })).toBeNull()
  })
})
