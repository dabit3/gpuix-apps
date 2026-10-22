import { describe, expect, test } from 'bun:test'
import { displayUrl, resolveInput, securityOf } from '../src/omnibox'
import { parseCellReply, scaleForCell } from '../src/term'

describe('omnibox', () => {
  test('URLs, hosts and searches', () => {
    expect(resolveInput('https://news.ycombinator.com')).toBe('https://news.ycombinator.com')
    expect(resolveInput('wikipedia.org')).toBe('https://wikipedia.org')
    expect(resolveInput('en.wikipedia.org/wiki/Web_browser')).toBe('https://en.wikipedia.org/wiki/Web_browser')
    expect(resolveInput('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveInput('kitty graphics protocol')).toBe('https://html.duckduckgo.com/html/?q=kitty%20graphics%20protocol')
    expect(resolveInput('ghostty')).toBe('https://html.duckduckgo.com/html/?q=ghostty')
    expect(resolveInput('/tmp/page.html')).toBe('file:///tmp/page.html')
    expect(resolveInput('  ')).toBe('about:blank')
  })
  test('security indicator', () => {
    expect(securityOf('https://example.com')).toBe('secure')
    expect(securityOf('http://example.com')).toBe('insecure')
    expect(securityOf('http://localhost:8080')).toBe('local')
    expect(securityOf('about:blank')).toBe('none')
  })
  test('display URL drops scheme and bare trailing slash', () => {
    expect(displayUrl('https://news.ycombinator.com/')).toBe('news.ycombinator.com')
    expect(displayUrl('https://en.wikipedia.org/wiki/Web_browser')).toBe('en.wikipedia.org/wiki/Web_browser')
    expect(displayUrl('http://example.com/')).toBe('http://example.com/')
    expect(displayUrl('about:blank')).toBe('')
  })
})

describe('terminal pixel ratio', () => {
  test('parses the CSI 16 t cell-size reply', () => {
    expect(parseCellReply('\x1b[6;34;16t')).toEqual({ height: 34, width: 16 })
    expect(parseCellReply('garbage')).toBeNull()
  })
  test('tall cells mean a 2x (Retina) terminal', () => {
    expect(scaleForCell(20)).toBe(1)
    expect(scaleForCell(40)).toBe(2)
  })
})
