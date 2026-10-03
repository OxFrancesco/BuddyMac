import AppKit
import ApplicationServices
import Foundation

let targetBundle = "org.buddytools.BuddyMacVerificationTarget"
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
struct Window: Codable {
    let id: UInt32
    let pid: Int32
    let app: String
    let title: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var bounds: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}
func scopedApp(_ pid: Int32) -> String? {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
    if app.bundleIdentifier == targetBundle { return "target" }
    // The packaged product has a known bundle name and executable. Do not allow another app by window title alone.
    if app.bundleIdentifier == "org.buddytools.BuddyMac", app.executableURL?.lastPathComponent == "BuddyMac" { return "buddymac" }
    return nil
}
func windows() -> [Window] {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return raw.compactMap { item in
        guard let pid = item[kCGWindowOwnerPID as String] as? Int32, let app = scopedApp(pid),
              let id = item[kCGWindowNumber as String] as? UInt32,
              let layer = item[kCGWindowLayer as String] as? Int, layer == 0 || layer == NSWindow.Level.floating.rawValue || layer == NSWindow.Level.statusBar.rawValue,
              let data = item[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: data as CFDictionary), rect.width > 100, rect.height > 80 else { return nil }
        return Window(id: id, pid: pid, app: app, title: item[kCGWindowName as String] as? String ?? "", x: rect.minX, y: rect.minY, width: rect.width, height: rect.height)
    }
}
func printJSON<T: Encodable>(_ value: T) {
    do { FileHandle.standardOutput.write(try JSONEncoder().encode(value)); FileHandle.standardOutput.write(Data("\n".utf8)) }
    catch { fail(error.localizedDescription) }
}
func event(_ type: CGEventType, _ point: CGPoint) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { fail("Could not create pointer event") }
    event.flags = []
    if type == .leftMouseDown || type == .leftMouseUp { event.setIntegerValueField(.mouseEventClickState, value: 1) }
    event.post(tap: .cghidEventTap)
}
let args = CommandLine.arguments
guard AXIsProcessTrusted() else { fail("Accessibility access is required; no permission prompt was opened") }
if args.count == 2, args[1] == "list" {
    printJSON(windows())
    exit(0)
}
if args.count == 5, args[1] == "hover", let pid = Int32(args[2]), scopedApp(pid) == "buddymac",
   let seconds = Double(args[4]), seconds >= 0.2, seconds <= 20 {
    guard CGPreflightPostEventAccess() else { fail("Event posting access is required; no permission prompt was opened") }
    guard !CGEventSource.buttonState(.combinedSessionState, button: .left), !CGEventSource.buttonState(.combinedSessionState, button: .right) else { fail("Release the mouse buttons before hovering") }
    guard let screen = NSScreen.screens.first, let original = CGEvent(source: nil)?.location else { fail("No display or pointer available") }
    let frame = screen.frame
    let point: CGPoint
    switch args[3] {
    case "right": point = CGPoint(x: frame.maxX - 2, y: frame.height / 2)
    case "left": point = CGPoint(x: frame.minX + 2, y: frame.height / 2)
    case "notch": point = CGPoint(x: frame.midX, y: frame.maxY - screen.visibleFrame.maxY + 6)
    case "away": point = CGPoint(x: frame.midX, y: frame.height - 10)
    default: fail("Hover zone must be right, left, notch or away")
    }
    defer { event(.mouseMoved, original) }
    event(.mouseMoved, point)
    Thread.sleep(forTimeInterval: seconds)
    printJSON(["pid": Double(pid), "x": point.x, "y": point.y, "seconds": seconds])
    exit(0)
}
guard args.count == 6, args[1] == "drag", let sourceID = UInt32(args[2]), let destinationID = UInt32(args[3]),
      let sourceX = Double(args[4]), sourceX.isFinite, let sourceY = Double(args[5]), sourceY.isFinite else {
    fail("Usage: verification-pointer list | drag <BuddyMac-window-ID> <target-window-ID> <source-screen-x> <source-screen-y>")
}
guard CGPreflightPostEventAccess() else { fail("Event posting access is required; no permission prompt was opened") }
guard !CGEventSource.buttonState(.combinedSessionState, button: .left), !CGEventSource.buttonState(.combinedSessionState, button: .right) else { fail("Release all mouse buttons before starting a verification drag") }
let available = windows()
guard let source = available.first(where: { $0.id == sourceID && $0.app == "buddymac" }),
      let target = available.first(where: { $0.id == destinationID && $0.app == "target" }) else { fail("Choose current on-screen BuddyMac and verification target window IDs") }
let start = CGPoint(x: sourceX, y: sourceY)
guard source.bounds.insetBy(dx: 8, dy: 8).contains(start) else { fail("Source point is outside the BuddyMac window") }
// Receiver NSView drop area: content x20..580, y225..355, Cocoa bottom-left origin.
// Its center is x300,y290 relative to content bottom, also the outer window bottom.
let end = CGPoint(x: target.bounds.minX + 300, y: target.bounds.maxY - 290)
guard target.bounds.insetBy(dx: 8, dy: 8).contains(end), !source.bounds.contains(end) else { fail("Receiver drop center must be visible outside BuddyMac's window") }
func topWindowID(at point: CGPoint) -> UInt32? {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for item in raw {
        guard (item[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              let data = item[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: data as CFDictionary), rect.contains(point) else { continue }
        return item[kCGWindowNumber as String] as? UInt32
    }
    return nil
}
guard topWindowID(at: start) == source.id else { fail("BuddyMac source point is covered by another window") }
guard topWindowID(at: end) == target.id else { fail("Receiver drop center is covered by another window") }
guard let original = CGEvent(source: nil)?.location else { fail("Could not read pointer position") }
var held = false
defer {
    if held { event(.leftMouseUp, end) }
    event(.mouseMoved, original)
}
event(.mouseMoved, start)
Thread.sleep(forTimeInterval: 0.15)
event(.leftMouseDown, start)
held = true
Thread.sleep(forTimeInterval: 0.15)
// Start with a short in-row motion before crossing the window boundary. Native GPUix
// dispatches asynchronously, so allow it to begin NSDraggingSession while still held.
let wake = CGPoint(x: start.x + (end.x >= start.x ? 14 : -14), y: start.y)
event(.leftMouseDragged, wake)
Thread.sleep(forTimeInterval: 0.3)
for step in 1...50 {
    let fraction = Double(step) / 50
    event(.leftMouseDragged, CGPoint(x: wake.x + (end.x - wake.x) * fraction, y: wake.y + (end.y - wake.y) * fraction))
    Thread.sleep(forTimeInterval: 0.025)
}
Thread.sleep(forTimeInterval: 0.2)
event(.leftMouseUp, end)
held = false
Thread.sleep(forTimeInterval: 0.25)
printJSON(["sourceWindow": Double(source.id), "targetWindow": Double(target.id), "startX": start.x, "startY": start.y, "endX": end.x, "endY": end.y, "originalPointerX": original.x, "originalPointerY": original.y])
