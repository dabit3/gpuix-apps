import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let name = w[kCGWindowName as String] as? String ?? ""
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  if name.contains(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Glass Kanban") {
    let b = w[kCGWindowBounds as String] as! [String: Any]
    print(owner, name, b["X"]!, b["Y"]!, b["Width"]!, b["Height"]!)
  }
}
