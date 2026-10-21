// Real-input driver for the demo video: posts CGEvents (mouse, wheel, keys)
// from a timed script. Usage: drive <script.txt>
// Lines: wait MS | move X Y | glide X1 Y1 X2 Y2 MS | click X Y | dbl X Y [shift]
//        drag X1 Y1 X2 Y2 MS | scroll X Y LINES COUNT INTERVAL_MS | key NAME [shift]
//        hover-path MS X1 Y1 X2 Y2 ... (smooth polyline) | # comment
import Foundation
import CoreGraphics

let src = CGEventSource(stateID: .hidSystemState)
var cur = CGPoint(x: 0, y: 0)

func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
func sleepMs(_ ms: Double) { usleep(useconds_t(max(0, ms) * 1000)) }
func mouse(_ type: CGEventType, _ p: CGPoint, clicks: Int64 = 1, flags: CGEventFlags = []) {
  let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)
  e?.setIntegerValueField(.mouseEventClickState, value: clicks)
  e?.flags = flags
  post(e)
  cur = p
}
func ease(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
func glide(_ a: CGPoint, _ b: CGPoint, _ ms: Double, dragging: Bool) {
  let steps = max(2, Int(ms / 8))
  for i in 1...steps {
    let t = ease(Double(i) / Double(steps))
    let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    mouse(dragging ? .leftMouseDragged : .mouseMoved, p)
    sleepMs(ms / Double(steps))
  }
}
let keyCodes: [String: CGKeyCode] = [
  "left": 123, "right": 124, "down": 125, "up": 126, "r": 15, "s": 1, "equal": 24, "minus": 27, "escape": 53, "return": 36,
]
func key(_ name: String, shift: Bool) {
  guard let code = keyCodes[name] else { return }
  let flags: CGEventFlags = shift ? .maskShift : []
  let d = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true); d?.flags = flags; post(d)
  sleepMs(40)
  let u = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false); u?.flags = flags; post(u)
}

let path = CommandLine.arguments[1]
let text = try! String(contentsOfFile: path, encoding: .utf8)
let t0 = Date()
for raw in text.split(separator: "\n") {
  let line = raw.trimmingCharacters(in: .whitespaces)
  if line.isEmpty || line.hasPrefix("#") { continue }
  let p = line.split(separator: " ").map(String.init)
  let n = p.dropFirst().map { Double($0) ?? 0 }
  FileHandle.standardError.write("[\(String(format: "%6.2f", Date().timeIntervalSince(t0)))] \(line)\n".data(using: .utf8)!)
  switch p[0] {
  case "wait": sleepMs(n[0])
  case "move": mouse(.mouseMoved, CGPoint(x: n[0], y: n[1]))
  case "glide": glide(CGPoint(x: n[0], y: n[1]), CGPoint(x: n[2], y: n[3]), n[4], dragging: false)
  case "to": glide(cur, CGPoint(x: n[0], y: n[1]), n[2], dragging: false)
  case "click":
    let q = CGPoint(x: n[0], y: n[1])
    mouse(.mouseMoved, q); sleepMs(30); mouse(.leftMouseDown, q); sleepMs(60); mouse(.leftMouseUp, q)
  case "dbl":
    let q = CGPoint(x: n[0], y: n[1])
    let f: CGEventFlags = p.count > 3 ? .maskShift : []
    mouse(.mouseMoved, q); sleepMs(30)
    mouse(.leftMouseDown, q, clicks: 1, flags: f); sleepMs(50); mouse(.leftMouseUp, q, clicks: 1, flags: f); sleepMs(80)
    mouse(.leftMouseDown, q, clicks: 2, flags: f); sleepMs(50); mouse(.leftMouseUp, q, clicks: 2, flags: f)
  case "drag":
    let a = CGPoint(x: n[0], y: n[1]), b = CGPoint(x: n[2], y: n[3])
    mouse(.mouseMoved, a); sleepMs(30); mouse(.leftMouseDown, a); sleepMs(40)
    glide(a, b, n[4], dragging: true)
    sleepMs(30); mouse(.leftMouseUp, b)
  case "scroll":
    let q = CGPoint(x: n[0], y: n[1])
    if cur != q { mouse(.mouseMoved, q); sleepMs(20) }
    for _ in 0..<Int(n[3]) {
      let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1, wheel1: Int32(n[2]), wheel2: 0, wheel3: 0)
      e?.location = q
      post(e)
      sleepMs(n[4])
    }
  case "key": key(p[1], shift: p.count > 2)
  default: break
  }
}
