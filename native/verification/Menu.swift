import AppKit
import ApplicationServices

let args = CommandLine.arguments
guard args.count == 3, let pid = Int32(args[1]), let running = NSRunningApplication(processIdentifier: pid),
      running.bundleIdentifier == "org.buddytools.BuddyMac", running.executableURL?.lastPathComponent == "BuddyMac",
      AXIsProcessTrusted() else { exit(1) }
let app = AXUIElementCreateApplication(pid)
func value(_ element: AXUIElement, _ name: String) -> Any? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}
func nodes(_ element: AXUIElement, _ depth: Int = 0) -> [AXUIElement] {
    guard depth < 8 else { return [] }
    return [element] + (value(element, "AXChildren") as? [AXUIElement] ?? []).flatMap { nodes($0, depth + 1) }
}
let action = args[2]
if action == "state" {
    print("{\"policy\":\(running.activationPolicy.rawValue),\"terminated\":\(running.isTerminated)}")
} else if action == "close" {
    guard let window = nodes(app).first(where: { value($0, "AXRole") as? String == "AXWindow" }),
          let button = value(window, "AXCloseButton"), AXUIElementPerformAction(button as! AXUIElement, kAXPressAction as CFString) == .success else { exit(2) }
} else {
    guard ["Settings", "Focus"].contains(action), let extras = value(app, "AXExtrasMenuBar"),
          let item = nodes(extras as! AXUIElement).first(where: { value($0, "AXRole") as? String == "AXMenuItem" && value($0, "AXTitle") as? String == action }),
          AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else { exit(3) }
}
