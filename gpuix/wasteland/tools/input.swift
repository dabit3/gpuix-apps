// Real-input driver for demo/testing recordings: CGEvent keys, clicks, smooth drags and wheel scrolls.
// usage: input key <code> [ctrl|shift|cmd ...] | click x y | move x y [ms] | drag x1 y1 x2 y2 [ms] | scroll x y dy [n] | type "text"
import Foundation
import CoreGraphics

let src = CGEventSource(stateID: .hidSystemState)
let a = CommandLine.arguments
func pt(_ x: String, _ y: String) -> CGPoint { CGPoint(x: Double(x)!, y: Double(y)!) }
func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
func sleepMs(_ ms: Double) { usleep(useconds_t(ms * 1000)) }
func cur() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
func glide(_ from: CGPoint, _ to: CGPoint, _ ms: Double, _ type: CGEventType) {
  let n = max(2, Int(ms / 16))
  for i in 1...n {
    let t = Double(i) / Double(n), k = t * t * (3 - 2 * t)
    let p = CGPoint(x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k)
    post(CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left))
    sleepMs(16)
  }
}
switch a[1] {
case "key":
  var flags: CGEventFlags = []
  for m in a.dropFirst(3) { if m == "ctrl" { flags.insert(.maskControl) }; if m == "shift" { flags.insert(.maskShift) }; if m == "cmd" { flags.insert(.maskCommand) } }
  let code = CGKeyCode(Int(a[2])!)
  let d = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true); d?.flags = flags; post(d)
  sleepMs(40)
  let u = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false); u?.flags = flags; post(u)
  let r = CGEvent(keyboardEventSource: src, virtualKey: 56, keyDown: false); r?.flags = []; post(r)
case "move":
  glide(cur(), pt(a[2], a[3]), a.count > 4 ? Double(a[4])! : 300, .mouseMoved)
case "click":
  let p = pt(a[2], a[3])
  glide(cur(), p, 250, .mouseMoved)
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)); sleepMs(70)
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left))
case "drag":
  let p0 = pt(a[2], a[3]), p1 = pt(a[4], a[5])
  glide(cur(), p0, 200, .mouseMoved)
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p0, mouseButton: .left)); sleepMs(80)
  glide(p0, p1, a.count > 6 ? Double(a[6])! : 700, .leftMouseDragged); sleepMs(60)
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p1, mouseButton: .left))
case "scroll":
  glide(cur(), pt(a[2], a[3]), 200, .mouseMoved)
  let dy = Int32(a[4])!, n = a.count > 5 ? Int(a[5])! : 1
  for _ in 0..<n { post(CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)); sleepMs(60) }
case "type":
  for ch in a[2].utf16 {
    var c = ch
    let d = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true); d?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c); post(d)
    let u = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false); u?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c); post(u)
    sleepMs(Double.random(in: 55...110))
  }
default: break
}
