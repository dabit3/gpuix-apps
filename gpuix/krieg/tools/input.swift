// Real HID input for demos: posts CGEvents at the session tap (keyboard text, shortcuts, mouse).
// usage:
//   input "text" [delayMs]                 type text (unicode key events, "\n" = Return)
//   input --key <keycode> [cmd|shift|cmdshift]
//   input --kd|--ku <keycode> [char]      single key down / up (hold keys)
//   input --scroll <dy> [n]                n pixel wheel events
//   input --move x y [ms]                  eased glide from the current position
//   input --click x y                      glide briefly, then click
//   input --drag x1 y1 x2 y2 [ms] [holdMs] press, eased drag at 60 Hz, hold, release
import Foundation
import CoreGraphics
let src = CGEventSource(stateID: .hidSystemState)
let args = CommandLine.arguments
func key(_ code: CGKeyCode, _ flags: CGEventFlags, _ text: String? = nil) {
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
    e.flags = flags
    if let t = text { let u = Array(t.utf16); e.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u) }
    e.post(tap: .cghidEventTap)
    usleep(8000)
  }
}
func mouse(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap)
}
func current() -> CGPoint { CGEvent(source: nil)!.location }
func ease(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
func glide(_ a: CGPoint, _ b: CGPoint, _ ms: Double, _ type: CGEventType) {
  let n = max(1, Int(ms / 1000 * 60))
  for i in 1...n {
    let t = ease(Double(i) / Double(n))
    mouse(type, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
    usleep(16_667)
  }
}
func num(_ i: Int, _ d: Double) -> Double { args.count > i ? Double(args[i])! : d }
switch args.count > 1 ? args[1] : "" {
case "--key":
  var f: CGEventFlags = []
  if args.count > 3 { if args[3].contains("cmd") { f.insert(.maskCommand) }; if args[3].contains("shift") { f.insert(.maskShift) } }
  key(CGKeyCode(Int(args[2])!), f)
case "--kd", "--ku":
  let down = args[1] == "--kd"
  let e = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(Int(args[2])!), keyDown: down)!
  if args.count > 3 && !args[3].isEmpty { let u = Array(args[3].utf16); e.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u) }
  e.post(tap: .cghidEventTap)
  usleep(40_000) // exiting right after a post can drop the event
case "--scroll":
  let n = Int(num(3, 1))
  for _ in 0..<n {
    CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 1, wheel1: Int32(num(2, -40)), wheel2: 0, wheel3: 0)!.post(tap: .cghidEventTap)
    usleep(16_667)
  }
case "--move":
  glide(current(), CGPoint(x: num(2, 0), y: num(3, 0)), num(4, 350), .mouseMoved)
case "--click":
  let p = CGPoint(x: num(2, 0), y: num(3, 0))
  glide(current(), p, 220, .mouseMoved)
  usleep(60_000); mouse(.leftMouseDown, p); usleep(70_000); mouse(.leftMouseUp, p)
case "--drag":
  let a = CGPoint(x: num(2, 0), y: num(3, 0)), b = CGPoint(x: num(4, 0), y: num(5, 0))
  glide(current(), a, 200, .mouseMoved)
  usleep(80_000); mouse(.leftMouseDown, a); usleep(150_000)
  glide(a, b, num(6, 900), .leftMouseDragged)
  let hold = num(7, 250)
  var waited = 0.0
  while waited < hold { mouse(.leftMouseDragged, b); usleep(50_000); waited += 50 }
  mouse(.leftMouseUp, b)
default:
  let delay = UInt32(num(2, 35))
  for ch in args[1] {
    if ch == "\n" { key(36, []) } else { key(49, [], String(ch)) }
    usleep(delay * 1000)
  }
}
