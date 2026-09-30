import AppKit
import ScreenCaptureKit

@MainActor
enum ScreenContextCapture {
    static var isAllowed: Bool { CGPreflightScreenCaptureAccess() }

    static func requestAccess() {
        if !CGRequestScreenCaptureAccess() {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        }
    }

    static func capture(processID: pid_t) async throws -> ScreenContext {
        guard isAllowed else { throw CaptureError.permission }
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        guard let info = windows.first(where: {
            ($0[kCGWindowOwnerPID as String] as? Int32) == processID
                && ($0[kCGWindowLayer as String] as? Int) == 0
        }), let windowID = info[kCGWindowNumber as String] as? UInt32 else { throw CaptureError.noWindow }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        try Task.checkCancellation()
        guard let window = content.windows.first(where: { $0.windowID == windowID }) else { throw CaptureError.noWindow }
        let configuration = SCStreamConfiguration()
        let scale = min(2, 1_600 / max(window.frame.width, window.frame.height, 1))
        configuration.width = max(1, Int(window.frame.width * scale))
        configuration.height = max(1, Int(window.frame.height * scale))
        configuration.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration)
        try Task.checkCancellation()
        guard let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
            throw CaptureError.encoding
        }
        return ScreenContext(windowTitle: window.title, jpeg: jpeg)
    }

    enum CaptureError: LocalizedError {
        case permission, noWindow, encoding
        var errorDescription: String? {
            switch self {
            case .permission: "Allow Screen Recording in Settings to use screen context."
            case .noWindow: "The active window could not be captured."
            case .encoding: "The screenshot could not be encoded."
            }
        }
    }
}
