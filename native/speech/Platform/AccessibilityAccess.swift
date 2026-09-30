import AppKit
@preconcurrency import ApplicationServices

/// Everything about the Accessibility permission that lets BuddyTalk type
/// into the field the user was using.
@MainActor
enum AccessibilityAccess {
    static let bundleIdentifier = Bundle.main.bundleIdentifier ?? "org.buddytools.BuddyTalk"
    static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!

    static var isGranted: Bool { AXIsProcessTrusted() }

    /// macOS only remembers permissions for a signed `.app`. A bare binary from
    /// `swift run` gets asked every launch.
    static var isRunningFromAppBundle: Bool { Bundle.main.bundleURL.pathExtension == "app" }

    /// Adds BuddyTalk to the Accessibility list (macOS shows its own dialog the
    /// first time) and opens the pane so the switch is one click away.
    @discardableResult
    static func request() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        let granted = AXIsProcessTrustedWithOptions(options as CFDictionary)
        if !granted { openSystemSettings() }
        return granted
    }

    static func openSystemSettings() {
        NSWorkspace.shared.open(settingsURL)
    }

    /// Selects the app in Finder so it can be dragged into the Accessibility list.
    static func revealInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
    }

    /// Clears the saved record. Needed when the list shows BuddyTalk as allowed
    /// but insertion still fails, which happens after a rebuild changes the signature.
    static func resetSystemRecord() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
        process.arguments = ["reset", "Accessibility", bundleIdentifier]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw ResetError(message: text.isEmpty ? "tccutil exited with status \(process.terminationStatus)." : text)
        }
    }

    struct ResetError: LocalizedError {
        let message: String
        var errorDescription: String? { "Couldn't reset the Accessibility record. \(message)" }
    }
}
