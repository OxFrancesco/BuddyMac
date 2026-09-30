import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]), ["read", "select-all", "focus"].contains(CommandLine.arguments[2]) else { fail("Usage: verification-target-ax <PID> <read|select-all|focus>") }
guard let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "org.buddytools.BuddyMacVerificationTarget" else { fail("PID must belong to BuddyMac Verification Target") }
guard AXIsProcessTrusted() else { fail("Accessibility permission is required for this helper; no permission prompt was opened") }
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}
let application = AXUIElementCreateApplication(pid)
var queue = [application]
var found: AXUIElement?
var examined = 0
while !queue.isEmpty && examined < 1000 {
    let element = queue.removeFirst()
    examined += 1
    if attribute(element, kAXRoleAttribute as CFString) as? String == kAXTextAreaRole { found = element; break }
    queue.append(contentsOf: attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? [])
}
guard let target = found else { fail("Target text area not found") }
let verb = CommandLine.arguments[2]
if verb == "focus" || verb == "select-all" {
    app.activate(options: [])
    guard AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { fail("Could not focus target text") }
}
if verb == "select-all" {
    let value = attribute(target, kAXValueAttribute as CFString) as? String ?? ""
    var range = CFRange(location: 0, length: (value as NSString).length)
    guard let axRange = AXValueCreate(.cfRange, &range), AXUIElementSetAttributeValue(target, kAXSelectedTextRangeAttribute as CFString, axRange) == .success else { fail("Could not select target text") }
}
let result: [String: Any] = ["pid": pid, "value": attribute(target, kAXValueAttribute as CFString) as? String ?? "", "selectedText": attribute(target, kAXSelectedTextAttribute as CFString) as? String ?? "", "focused": attribute(target, kAXFocusedAttribute as CFString) as? Bool ?? false]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
FileHandle.standardOutput.write(Data("\n".utf8))
