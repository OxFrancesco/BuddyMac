import AppKit
import CryptoKit
import Foundation

struct CopiedFile: Codable {
    let sourcePath: String
    let copiedPath: String
    let bytes: Int
    let sourceSHA256: String
    let copiedSHA256: String
}
struct TextSnapshot: Codable {
    let date: String
    let text: String
    let selectionLocation: Int
    let selectionLength: Int
}
struct DropSnapshot: Codable {
    let date: String
    let accepted: Bool
    let files: [CopiedFile]
    let error: String?
}
struct TargetState: Codable {
    let pid: Int32
    let bundleIdentifier: String
    let windowTitle: String
    var ready: Bool
    var text: String
    var selectionLocation: Int
    var selectionLength: Int
    var textChanges: [TextSnapshot]
    var drops: [DropSnapshot]
}

func failure(_ message: String) -> NSError {
    NSError(domain: "BuddyMacVerification", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func timestamp() -> String { ISO8601DateFormatter().string(from: Date()) }

final class DropTarget: NSView {
    weak var owner: TargetDelegate?
    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
        wantsLayer = true
        layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        layer?.borderWidth = 2
        layer?.borderColor = NSColor.separatorColor.cgColor
        let label = NSTextField(labelWithString: "Drop test files here")
        label.frame = NSRect(x: 20, y: 48, width: 520, height: 30)
        label.font = .systemFont(ofSize: 22)
        label.alignment = .center
        addSubview(label)
        setAccessibilityLabel("Verification file drop destination")
    }
    required init?(coder: NSCoder) { fatalError("Not supported") }
    func urls(_ sender: NSDraggingInfo) -> [URL] {
        sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        sender.draggingSourceOperationMask.contains(.copy) && !urls(sender).isEmpty ? .copy : []
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { draggingEntered(sender) }
    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { !draggingEntered(sender).isEmpty }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool { owner?.receive(urls(sender)) ?? false }
}

final class TargetDelegate: NSObject, NSApplicationDelegate, NSTextViewDelegate {
    let output: URL
    var window: NSWindow!
    var textView: NSTextView!
    var state = TargetState(pid: getpid(), bundleIdentifier: "org.buddytools.BuddyMacVerificationTarget", windowTitle: "BuddyMac Verification Target", ready: false, text: "this are a test sentence.", selectionLocation: 0, selectionLength: 25, textChanges: [], drops: [])
    init(output: URL) { self.output = output }
    func save() {
        do {
            let data = try JSONEncoder().encode(state)
            try data.write(to: output.appendingPathComponent("state.json"), options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: output.appendingPathComponent("state.json").path)
        } catch {
            FileHandle.standardError.write(Data("State write failed: \(error.localizedDescription)\n".utf8))
        }
    }
    func snapshot() {
        guard let textView else { return }
        let range = textView.selectedRange()
        state.text = textView.string
        state.selectionLocation = range.location
        state.selectionLength = range.length
        state.textChanges.append(TextSnapshot(date: timestamp(), text: state.text, selectionLocation: range.location, selectionLength: range.length))
        save()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 400), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = state.windowTitle
        window.setFrame(NSRect(x: 100, y: 100, width: 600, height: 400), display: true)
        window.isReleasedWhenClosed = false
        let content = window.contentView!
        let drop = DropTarget(frame: NSRect(x: 20, y: 225, width: 560, height: 130))
        drop.owner = self
        content.addSubview(drop)
        let label = NSTextField(labelWithString: "Editable verification text")
        label.frame = NSRect(x: 20, y: 192, width: 560, height: 20)
        content.addSubview(label)
        let scroll = NSScrollView(frame: NSRect(x: 20, y: 20, width: 560, height: 165))
        scroll.borderType = .bezelBorder
        scroll.hasVerticalScroller = true
        textView = NSTextView(frame: scroll.bounds)
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.font = .monospacedSystemFont(ofSize: 20, weight: .regular)
        textView.textContainerInset = NSSize(width: 12, height: 12)
        textView.string = state.text
        textView.setAccessibilityLabel("Verification editable text")
        textView.identifier = NSUserInterfaceItemIdentifier("verification-text")
        textView.delegate = self
        scroll.documentView = textView
        content.addSubview(scroll)
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        NSApp.mainMenu = menu
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(textView)
        textView.setSelectedRange(NSRange(location: 0, length: (state.text as NSString).length))
        state.ready = true
        snapshot()
    }
    func textDidChange(_ notification: Notification) { snapshot() }
    func textViewDidChangeSelection(_ notification: Notification) { snapshot() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func receive(_ sources: [URL]) -> Bool {
        var files: [CopiedFile] = []
        do {
            guard !sources.isEmpty else { throw failure("No file URLs received") }
            for source in sources {
                guard try source.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { throw failure("Only regular test files are accepted") }
            }
            let batch = output.appendingPathComponent("copies/\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: batch, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            for (index, source) in sources.enumerated() {
                let destination = batch.appendingPathComponent("\(index)-\(source.lastPathComponent)")
                let original = try Data(contentsOf: source)
                try FileManager.default.copyItem(at: source, to: destination)
                let copied = try Data(contentsOf: destination)
                guard original == copied else { throw failure("Copied bytes differ from source") }
                files.append(CopiedFile(sourcePath: source.path, copiedPath: destination.path, bytes: copied.count, sourceSHA256: digest(original), copiedSHA256: digest(copied)))
            }
            state.drops.append(DropSnapshot(date: timestamp(), accepted: true, files: files, error: nil))
            save()
            return true
        } catch {
            state.drops.append(DropSnapshot(date: timestamp(), accepted: false, files: files, error: error.localizedDescription))
            save()
            return false
        }
    }
}

do {
    guard let raw = ProcessInfo.processInfo.environment["BUDDYMAC_VERIFICATION_OUTPUT_DIR"], raw.hasPrefix("/") else { throw failure("Set BUDDYMAC_VERIFICATION_OUTPUT_DIR to an empty temporary directory") }
    let output = URL(fileURLWithPath: raw, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
    let allowed = [URL(fileURLWithPath: "/private/tmp"), FileManager.default.temporaryDirectory].map { $0.resolvingSymlinksInPath().path + "/" }
    guard allowed.contains(where: { output.path.hasPrefix($0) }), try FileManager.default.contentsOfDirectory(atPath: output.path).isEmpty else { throw failure("Output must be an existing empty directory beneath /tmp or the system temporary directory") }
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: output.path)
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let delegate = TargetDelegate(output: output)
    app.delegate = delegate
    app.run()
    withExtendedLifetime(delegate) {}
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
