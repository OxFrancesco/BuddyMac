import AppKit
@preconcurrency import ApplicationServices
import Carbon

@MainActor
struct InsertionTarget {
    let appName: String
    let bundleIdentifier: String?
    let selectedText: String?
    fileprivate let application: NSRunningApplication
    fileprivate let focusedElement: AXUIElement?
    fileprivate let selectedRange: CFRange?
    fileprivate let originalValue: String?
    let isSecure: Bool
    var processID: pid_t { application.processIdentifier }
}

enum InsertionResult: Equatable {
    case inserted
    case copied(reason: String, needsAccessibility: Bool = false)
    case cancelled
}

@MainActor
final class TextInsertion {
    var accessibilityGranted: Bool { AccessibilityAccess.isGranted }

    func snapshot() -> InsertionTarget? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              app.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              String(app.processIdentifier) != ProcessInfo.processInfo.environment["BUDDYMAC_UI_PID"],
              app.bundleIdentifier != "org.buddytools.BuddyMac" else { return nil }
        let element = accessibilityGranted ? focusedElement(in: app) : nil
        let isSecure = element.map { stringAttribute($0, kAXSubroleAttribute) == kAXSecureTextFieldSubrole } ?? false
        return InsertionTarget(
            appName: app.localizedName ?? "this app",
            bundleIdentifier: app.bundleIdentifier,
            selectedText: isSecure ? nil : element.flatMap { stringAttribute($0, kAXSelectedTextAttribute) },
            application: app,
            focusedElement: element,
            selectedRange: isSecure ? nil : element.flatMap(selectedRange),
            originalValue: isSecure ? nil : element.flatMap { stringAttribute($0, kAXValueAttribute) },
            isSecure: isSecure
        )
    }

    func insert(
        _ text: String,
        into target: InsertionTarget?,
        restoreClipboard: Bool = true,
        autoPaste: Bool = true
    ) async -> InsertionResult {
        guard !Task.isCancelled else { return .cancelled }
        guard !text.isEmpty else { return .copied(reason: "There was no text to insert.") }
        guard autoPaste else { return copy(text, reason: "Copied to the clipboard.") }
        guard accessibilityGranted else {
            putOnClipboard(text)
            return .copied(reason: "Copied. Allow Accessibility so BuddyMac can type into \(target?.appName ?? "other apps").",
                           needsAccessibility: true)
        }
        guard let target, let element = target.focusedElement else {
            return copy(text, reason: "Copied. Focus a text field before starting dictation.")
        }
        guard !target.isSecure else {
            return copy(text, reason: "Copied. Automatic insertion is disabled in password fields.")
        }
        guard destinationIsUnchanged(target) else {
            return copy(text, reason: "Copied. The destination changed while you were dictating.")
        }

        guard isTextInput(element) else {
            return copy(text, reason: "Copied. The focused control does not accept text.")
        }
        // Some editors accept AXSelectedText writes without updating their document.
        // Paste once through the editor's input events, then verify the observed value.
        guard let source = CGEventSource(stateID: .privateState),
              let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false) else {
            return copy(text, reason: "Copied. macOS could not send the paste shortcut.")
        }

        let pasteboard = NSPasteboard.general
        let previous = restoreClipboard ? ClipboardContents(pasteboard) : nil
        guard destinationIsUnchanged(target) else {
            return copy(text, reason: "Copied. The destination changed while you were dictating.")
        }
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        let changeCount = pasteboard.changeCount
        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand
        keyDown.postToPid(target.application.processIdentifier)
        keyUp.postToPid(target.application.processIdentifier)

        switch await confirmInsertion(text, into: target) {
        case .confirmed:
            if let previous, pasteboard.changeCount == changeCount {
                previous.restore(to: pasteboard)
            }
            return .inserted
        case .cancelled: return .cancelled
        case .unconfirmed:
            return .copied(reason: "Paste was sent to \(target.appName). The text is also on the clipboard because the app did not confirm insertion.")
        }
    }

    private enum InsertionConfirmation { case confirmed, unconfirmed, cancelled }

    private func confirmInsertion(_ text: String, into target: InsertionTarget) async -> InsertionConfirmation {
        guard let element = target.focusedElement else { return .unconfirmed }
        let expected = expectedValue(afterInserting: text, into: target)
        for _ in 0..<20 {
            guard !Task.isCancelled else { return .cancelled }
            guard !target.application.isTerminated else { return .unconfirmed }
            if let expected, stringAttribute(element, kAXValueAttribute) == expected { return .confirmed }
            if expected == nil, stringAttribute(element, kAXSelectedTextAttribute) == text { return .confirmed }
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return .cancelled }
        }
        return .unconfirmed
    }

    private func destinationIsUnchanged(_ target: InsertionTarget) -> Bool {
        guard !target.application.isTerminated,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == target.application.processIdentifier,
              let expected = target.focusedElement,
              let current = focusedElement(in: target.application),
              CFEqual(expected, current),
              stringAttribute(current, kAXSubroleAttribute) != kAXSecureTextFieldSubrole else { return false }
        if let originalValue = target.originalValue,
           stringAttribute(current, kAXValueAttribute) != originalValue { return false }
        if let expectedRange = target.selectedRange {
            guard let currentRange = selectedRange(current),
                  expectedRange.location == currentRange.location,
                  expectedRange.length == currentRange.length else { return false }
        }
        if let selected = target.selectedText,
           stringAttribute(current, kAXSelectedTextAttribute) != selected { return false }
        return true
    }

    private func expectedValue(afterInserting text: String, into target: InsertionTarget) -> String? {
        guard let value = target.originalValue, let range = target.selectedRange,
              range.location >= 0, range.length >= 0,
              range.location <= (value as NSString).length,
              range.length <= (value as NSString).length - range.location else { return nil }
        return (value as NSString).replacingCharacters(
            in: NSRange(location: range.location, length: range.length), with: text
        )
    }

    private func isTextInput(_ element: AXUIElement) -> Bool {
        let role = stringAttribute(element, kAXRoleAttribute)
        return [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role ?? "") || selectedRange(element) != nil
    }

    private func focusedElement(in application: NSRunningApplication) -> AXUIElement? {
        let app = AXUIElementCreateApplication(application.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 0.3)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        let element = unsafeDowncast(value, to: AXUIElement.self)
        AXUIElementSetMessagingTimeout(element, 0.3)
        return element
    }

    private func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private func selectedRange(_ element: AXUIElement) -> CFRange? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else { return nil }
        var range = CFRange()
        return AXValueGetValue(axValue, .cfRange, &range) ? range : nil
    }

    private func copy(_ text: String, reason: String) -> InsertionResult {
        putOnClipboard(text)
        return .copied(reason: reason)
    }

    private func putOnClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

@MainActor
private struct ClipboardContents {
    let items: [[NSPasteboard.PasteboardType: Data]]

    init(_ pasteboard: NSPasteboard) {
        items = (pasteboard.pasteboardItems ?? []).map { item in
            Dictionary(uniqueKeysWithValues: item.types.compactMap { type in
                item.data(forType: type).map { (type, $0) }
            })
        }
    }

    func restore(to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        let restored = items.map { values in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        if !restored.isEmpty { pasteboard.writeObjects(restored) }
    }
}
