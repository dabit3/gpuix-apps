// Renders gradient initials avatars to assets/avatars/<id>.png (run: swift tools/make-avatars.swift)
import AppKit

let people: [(String, String, String, String)] = [
  ("maya", "MC", "#F97316", "#FB7185"),
  ("jonas", "JW", "#0EA5E9", "#22D3EE"),
  ("priya", "PS", "#10B981", "#84CC16"),
  ("diego", "DR", "#F59E0B", "#EF4444"),
  ("sofia", "SL", "#EC4899", "#F97316"),
  ("kenji", "KT", "#3B82F6", "#06B6D4"),
  ("amara", "AO", "#14B8A6", "#3B82F6"),
  ("liam", "LB", "#64748B", "#0EA5E9"),
]

func color(_ hex: String) -> NSColor {
  var v: UInt64 = 0
  Scanner(string: String(hex.dropFirst())).scanHexInt64(&v)
  return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

let size = 96
for (id, initials, a, b) in people {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let rect = NSRect(x: 0, y: 0, width: size, height: size)
  NSGradient(starting: color(a), ending: color(b))!.draw(in: NSBezierPath(ovalIn: rect), angle: -45)
  let style = NSMutableParagraphStyle(); style.alignment = .center
  let font = NSFont.systemFont(ofSize: 38, weight: .semibold)
  let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white, .paragraphStyle: style]
  let str = NSAttributedString(string: initials, attributes: attrs)
  let h = str.size().height
  str.draw(in: NSRect(x: 0, y: (CGFloat(size) - h) / 2 - 1, width: CGFloat(size), height: h))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "assets/avatars/\(id).png"))
}
print("wrote \(people.count) avatars")
