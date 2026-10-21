import Cocoa
import CoreGraphics

// Reads commands from stdin, one per line:
//  move x y | glide x y ms | down | up | click x y | drag x y ms
//  key code [cmd] [ctrl] [shift] [alt] | type text... | sleep ms | front name
let src = CGEventSource(stateID: .hidSystemState)
var pos = CGEvent(source: nil)!.location
var held = false

func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
func mouse(_ t: CGEventType, _ p: CGPoint) { post(CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)) }
func moveTo(_ p: CGPoint) { pos = p; mouse(held ? .leftMouseDragged : .mouseMoved, p) }
func glide(_ to: CGPoint, _ ms: Double) {
  let from = pos
  let steps = max(1, Int(ms / 8))
  let start = Date()
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    let e = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
    moveTo(CGPoint(x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e))
    let target = start.addingTimeInterval(ms / 1000 * t)
    let d = target.timeIntervalSinceNow
    if d > 0 { usleep(UInt32(d * 1_000_000)) }
  }
}
func frontmost() -> String { NSWorkspace.shared.frontmostApplication?.localizedName ?? "" }
let keymap: [Character: (CGKeyCode, Bool)] = {
  var m: [Character: (CGKeyCode, Bool)] = [:]
  let lower: [(Character, CGKeyCode)] = [("a",0),("s",1),("d",2),("f",3),("h",4),("g",5),("z",6),("x",7),("c",8),("v",9),("b",11),("q",12),("w",13),("e",14),("r",15),("y",16),("t",17),("1",18),("2",19),("3",20),("4",21),("6",22),("5",23),("=",24),("9",25),("7",26),("-",27),("8",28),("0",29),("]",30),("o",31),("u",32),("[",33),("i",34),("p",35),("l",37),("j",38),("'",39),("k",40),(";",41),("\\",42),(",",43),("/",44),("n",45),("m",46),(".",47),(" ",49),("`",50)]
  for (c, k) in lower { m[c] = (k, false) }
  let shifted: [(Character, Character)] = [("!","1"),("@","2"),("#","3"),("$","4"),("%","5"),("^","6"),("&","7"),("*","8"),("(","9"),(")","0"),("_","-"),("+","="),("{","["),("}","]"),("|","\\"),(":",";"),("\"","'"),("<",","),(">","."),("?","/"),("~","`")]
  for (s, b) in shifted { m[s] = (m[b]!.0, true) }
  for c in "abcdefghijklmnopqrstuvwxyz" { m[Character(c.uppercased())] = (m[c]!.0, true) }
  return m
}()
func key(_ code: CGKeyCode, _ flags: CGEventFlags) {
  let d = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true); d?.flags = flags; post(d)
  usleep(25_000)
  let u = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false); u?.flags = flags; post(u)
}
while let line = readLine() {
  let p = line.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
  guard let cmd = p.first else { continue }
  let n = p.dropFirst().compactMap { Double($0) }
  switch cmd {
  case "move": moveTo(CGPoint(x: n[0], y: n[1]))
  case "glide": glide(CGPoint(x: n[0], y: n[1]), n[2])
  case "down": held = true; mouse(.leftMouseDown, pos)
  case "up": held = false; mouse(.leftMouseUp, pos)
  case "click": moveTo(CGPoint(x: n[0], y: n[1])); usleep(30_000); mouse(.leftMouseDown, pos); usleep(40_000); mouse(.leftMouseUp, pos)
  case "drag": held = true; mouse(.leftMouseDown, pos); usleep(60_000); glide(CGPoint(x: n[0], y: n[1]), n[2]); usleep(60_000); mouse(.leftMouseUp, pos); held = false
  case "key":
    var f: CGEventFlags = []
    for m in p.dropFirst(2) { if m == "cmd" { f.insert(.maskCommand) }; if m == "ctrl" { f.insert(.maskControl) }; if m == "shift" { f.insert(.maskShift) }; if m == "alt" { f.insert(.maskAlternate) } }
    key(CGKeyCode(p[1])!, f)
  case "type":
    let text = line.dropFirst(5)
    for ch in text {
      if let (k, s) = keymap[ch] { key(k, s ? .maskShift : []) }
      usleep(UInt32(55_000 + Int.random(in: 0...45_000)))
    }
  case "sleep": usleep(UInt32(n[0] * 1000))
  case "front":
    if !frontmost().lowercased().contains(p[1].lowercased()) { FileHandle.standardError.write("not frontmost: \(frontmost())\n".data(using: .utf8)!); exit(3) }
  case "where": print(Int(pos.x), Int(pos.y))
  default: break
  }
}
