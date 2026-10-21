// Demo input driver: posts real CGEvent mouse/keyboard input to the native window.
// While "tracking" it reads NEON_TELEMETRY (the pilot's aim point) and moves the real
// mouse there, so the paddle is driven by the OS pointer exactly like a player's hand.
// Usage: drive <windowX> <windowY> <telemetryPath>
import CoreGraphics
import Foundation

let args = CommandLine.arguments
let winX = Double(args[1])!, winY = Double(args[2])!
let telemetryPath = args[3]
let fieldX = winX + 24, fieldY = winY + 56
let src = CGEventSource(stateID: .hidSystemState)
let start = Date()
var mouse = CGPoint(x: winX + 1000, y: winY + 600)

func now() -> Double { Date().timeIntervalSince(start) }
func log(_ s: String) { FileHandle.standardError.write("[\(String(format: "%6.2f", now()))] \(s)\n".data(using: .utf8)!) }
func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}
func move(_ p: CGPoint) { mouse = p; post(.mouseMoved, p) }
func click() { post(.leftMouseDown, mouse); usleep(55_000); post(.leftMouseUp, mouse) }
func keyDown(_ code: CGKeyCode) { CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)?.post(tap: .cghidEventTap) }
func keyUp(_ code: CGKeyCode) { CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap) }
func tap(_ code: CGKeyCode, hold: useconds_t = 70_000) { keyDown(code); usleep(hold); keyUp(code) }
func wait(_ s: Double) { usleep(useconds_t(s * 1_000_000)) }
func glide(to p: CGPoint, over s: Double) {
  let a = mouse, steps = max(1, Int(s * 60))
  for i in 1...steps {
    let t = Double(i) / Double(steps), e = t * t * (3 - 2 * t)
    move(CGPoint(x: a.x + (p.x - a.x) * e, y: a.y + (p.y - a.y) * e)); wait(1.0 / 60)
  }
}
struct Telemetry { var mode = "", phase = "", aim = 380.0, paddle = 380.0, laser = false, lives = 0 }
func read() -> Telemetry {
  guard let s = try? String(contentsOfFile: telemetryPath, encoding: .utf8) else { return Telemetry() }
  let f = s.split(separator: " ")
  guard f.count >= 6 else { return Telemetry() }
  return Telemetry(mode: String(f[0]), phase: String(f[1]), aim: Double(f[2]) ?? 380, paddle: Double(f[3]) ?? 380, laser: f[4] == "1", lives: Int(f[5]) ?? 0)
}
let rowY = fieldY + 600
/// Mouse play: follow the aim point with a little human lag; click to serve and to fire lasers.
var lastClick = 0.0, serveSeen = -1.0
func trackMouse(for seconds: Double, miss: Bool = false) {
  let end = now() + seconds
  while now() < end {
    let t = read()
    if t.mode != "playing" { wait(1.0 / 60); continue }
    var aim = t.aim
    if miss { aim = t.aim < 380 ? min(740, t.aim + 330) : max(20, t.aim - 330) }
    let x = mouse.x + (fieldX + aim - mouse.x) * 0.45
    move(CGPoint(x: x, y: rowY))
    if t.phase == "serve" {
      if serveSeen < 0 { serveSeen = now() }
      if now() - serveSeen > 0.7 { click(); serveSeen = -1 }
    } else { serveSeen = -1 }
    if t.laser && !miss && now() - lastClick > 0.3 { click(); lastClick = now() }
    wait(1.0 / 60)
  }
}
/// Keyboard play: hold Left/Right (key codes 123/124) toward the aim point.
func trackKeys(for seconds: Double) {
  let end = now() + seconds
  var held: CGKeyCode? = nil
  while now() < end {
    let t = read()
    let d = t.aim - t.paddle
    let want: CGKeyCode? = abs(d) < 10 ? nil : (d < 0 ? 123 : 124)
    if want != held {
      if let h = held { keyUp(h) }
      if let w = want { keyDown(w) }
      held = want
    }
    if t.phase == "serve" { tap(49) }
    wait(1.0 / 120)
  }
  if let h = held { keyUp(h) }
}
func untilMode(_ m: String, timeout: Double) { let end = now() + timeout; while now() < end && read().mode != m { wait(0.05) } }

let script = ProcessInfo.processInfo.environment["DRIVE_SCRIPT"] ?? "demo"
log("start \(script)")
move(mouse)
if script == "demo" {
  wait(3.0)                                                     // attract mode on the title screen
  glide(to: CGPoint(x: fieldX + 380, y: fieldY + 394), over: 0.8) // Play button
  wait(0.25); click(); log("play")
  wait(0.3); glide(to: CGPoint(x: fieldX + 380, y: rowY), over: 0.4)
  tap(3); log("F: perf HUD")                                  // F
  trackMouse(for: 24)
  tap(53); log("esc: pause")                                  // Esc
  wait(1.2)
  glide(to: CGPoint(x: fieldX + 380, y: fieldY + 383), over: 0.6)  // hover Restart
  wait(0.5)
  glide(to: CGPoint(x: fieldX + 380, y: fieldY + 327), over: 0.4)  // Resume
  wait(0.3); click(); log("resume")
  trackMouse(for: 14)
  move(CGPoint(x: winX + 1000, y: winY + 600)); log("keyboard")
  trackKeys(for: 10)
  log("miss on purpose")
  while read().mode == "playing" { trackMouse(for: 0.5, miss: true) }
  untilMode("gameover", timeout: 30)
  wait(1.4)
  for k: CGKeyCode in [45, 2, 15] { tap(k); wait(0.22) }      // N D R
  // Real Return never reaches the native <input> (GPUIX finding), so click Save.
  glide(to: CGPoint(x: winX + 470, y: winY + 470), over: 0.5)
  wait(0.2); click(); log("save")
  wait(3.0)
}
log("done")
