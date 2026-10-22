// Real HID input for demos: posts CGEvents at the session tap (keyboard text, shortcuts, mouse).
// usage:
//   input "text" [delayMs]                 type text (unicode key events, "\n" = Return)
//   input --key <keycode> [cmd|shift|cmdshift]
//   input --move x y [ms]                  eased glide from the current position
//   input --click x y                      glide briefly, then click
//   input --drag x1 y1 x2 y2 [ms] [holdMs] press, eased drag at 60 Hz, hold, release
//   input --path ms x1 y1 x2 y2 ...        press at the first point, drag through all points at constant speed, release
//   input --scroll dy [count] [ms]         line-wheel scroll, count events spaced ms apart
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
case "--path":
  let ms = num(2, 2000)
  var pts: [CGPoint] = []
  var i = 3
  while i + 1 < args.count { pts.append(CGPoint(x: Double(args[i])!, y: Double(args[i + 1])!)); i += 2 }
  var lens: [Double] = [0]
  for j in 1..<pts.count { lens.append(lens[j - 1] + hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y)) }
  glide(current(), pts[0], 200, .mouseMoved)
  usleep(60_000); mouse(.leftMouseDown, pts[0]); usleep(60_000)
  let n = max(1, Int(ms / 1000 * 60)), total = lens.last!
  var seg = 1
  for k in 1...n {
    let d = total * Double(k) / Double(n)
    while seg < pts.count - 1 && lens[seg] < d { seg += 1 }
    let t = (d - lens[seg - 1]) / max(1e-6, lens[seg] - lens[seg - 1])
    mouse(.leftMouseDragged, CGPoint(x: pts[seg - 1].x + (pts[seg].x - pts[seg - 1].x) * t, y: pts[seg - 1].y + (pts[seg].y - pts[seg - 1].y) * t))
    usleep(16_667)
  }
  usleep(50_000); mouse(.leftMouseUp, pts.last!)
case "--scroll":
  let dy = Int32(num(2, -3)), count = Int(num(3, 1)), gap = UInt32(num(4, 40) * 1000)
  for _ in 0..<count { CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)!.post(tap: .cghidEventTap); usleep(gap) }
case "--key":
  var f: CGEventFlags = []
  if args.count > 3 { if args[3].contains("cmd") { f.insert(.maskCommand) }; if args[3].contains("shift") { f.insert(.maskShift) } }
  key(CGKeyCode(Int(args[2])!), f)
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
