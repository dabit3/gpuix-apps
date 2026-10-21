// Draws examples/sync-diagram.png (the architecture figure in notes.md) with AppKit.
import AppKit

let W: CGFloat = 1360, H: CGFloat = 520
let img = NSImage(size: NSSize(width: W, height: H))
func hex(_ s: String, _ a: CGFloat = 1) -> NSColor {
  let v = Int(s.dropFirst(), radix: 16)!
  return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: a)
}
let bg = hex("#0d1117"), line = hex("#30363d"), text = hex("#f0f3f6"), dim = hex("#9ea7b3")
let blue = hex("#71b7ff"), green = hex("#26cd4d"), yellow = hex("#f0b72f")
func label(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ c: NSColor, bold: Bool = false, center: Bool = true) {
  let f = NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
  let a: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: c]
  let str = NSAttributedString(string: s, attributes: a)
  let sz = str.size()
  str.draw(at: NSPoint(x: center ? x - sz.width / 2 : x, y: H - y - sz.height / 2))
}
func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ accent: NSColor, _ title: String, _ lines: [String]) {
  let r = NSRect(x: x, y: H - y - h, width: w, height: h)
  let p = NSBezierPath(roundedRect: r, xRadius: 16, yRadius: 16)
  hex("#161b22").setFill(); p.fill()
  line.setStroke(); p.lineWidth = 2; p.stroke()
  let bar = NSBezierPath(roundedRect: NSRect(x: x + 22, y: H - y - 40, width: 32, height: 6), xRadius: 3, yRadius: 3)
  accent.setFill(); bar.fill()
  label(title, x + 22, y + 66, 26, text, bold: true, center: false)
  for (i, l) in lines.enumerated() { label(l, x + 22, y + 112 + CGFloat(i) * 34, 19, dim, center: false) }
}
func arrow(_ x1: CGFloat, _ x2: CGFloat, _ y: CGFloat, _ c: NSColor, _ t: String) {
  let p = NSBezierPath(); p.move(to: NSPoint(x: x1, y: H - y)); p.line(to: NSPoint(x: x2 - 14, y: H - y))
  c.setStroke(); p.lineWidth = 3; p.stroke()
  let h = NSBezierPath(); h.move(to: NSPoint(x: x2, y: H - y)); h.line(to: NSPoint(x: x2 - 16, y: H - y + 9)); h.line(to: NSPoint(x: x2 - 16, y: H - y - 9)); h.close()
  c.setFill(); h.fill()
  label(t, (x1 + x2) / 2, y - 22, 17, c)
}
img.lockFocus()
bg.setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill()
label("Ledger offline sync", 60, 52, 22, dim, bold: true, center: false)
box(60, 110, 360, 300, blue, "Device", ["SQLite op log", "Hybrid logical clock", "UI reads local state", "Writes < 16 ms"])
box(500, 110, 360, 300, yellow, "Outbox", ["Batches of 200 ops", "Idempotent by op.id", "Resumable receipts", "Drains on reachability"])
box(940, 110, 360, 300, green, "Server replica", ["Merge per entity", "LWW fields, CRDT sums", "Fan-out to devices", "Tombstone compaction"])
arrow(420, 500, 230, yellow, "append")
arrow(860, 940, 230, green, "push")
arrow(940, 860, 330, blue, "")
arrow(500, 420, 330, blue, "")
label("pull + rebase", 680, 452, 17, blue)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
