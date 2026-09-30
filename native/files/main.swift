import AppKit
import Foundation

struct Request: Decodable {
    let action: String
    let paths: [String]?
}

struct ShelfFile: Encodable {
    let path: String
    let name: String
    let exists: Bool
    let size: Int?
    let kind: String?
    let modifiedAt: String?
}

func failure(_ message: String) -> NSError {
    NSError(domain: "BuddyMac.Files", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

func describe(_ path: String) -> ShelfFile {
    let url = URL(fileURLWithPath: path)
    let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey])
    let kind = try? url.resourceValues(forKeys: [.localizedTypeDescriptionKey]).localizedTypeDescription
    return ShelfFile(path: path, name: url.lastPathComponent, exists: values?.isRegularFile == true,
        size: values?.fileSize, kind: kind,
        modifiedAt: values?.contentModificationDate.map { ISO8601DateFormatter().string(from: $0) })
}

do {
    let request = try JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile())
    let store = BucketStore()
    let pasteboard = ProcessInfo.processInfo.environment["BUDDYMAC_PASTEBOARD_NAME"].map { NSPasteboard(name: NSPasteboard.Name($0)) } ?? NSPasteboard.general
    let inputs = request.paths ?? []
    switch request.action {
    case "list": break
    case "add":
        guard !inputs.isEmpty else { throw failure("Choose at least one file") }
        try store.add(inputs)
    case "remove":
        _ = try store.access { paths in paths.removeAll { inputs.contains($0) } }
    case "clear":
        _ = try store.access { $0.removeAll() }
    case "import":
        let legacy = try store.legacyPaths()
        _ = try store.access { paths in for path in legacy where !paths.contains(path) { paths.append(path) } }
    case "copy":
        guard !inputs.isEmpty else { throw failure("Select files to copy") }
        let urls = try inputs.map { NSURL(fileURLWithPath: try store.canonical($0)) }
        pasteboard.clearContents()
        guard pasteboard.writeObjects(urls) else { throw failure("Could not copy files") }
    case "paste":
        let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        guard !urls.isEmpty else { throw failure("The clipboard contains no files") }
        try store.add(urls.map(\.path))
    case "reveal":
        let urls = try inputs.map { URL(fileURLWithPath: try store.canonical($0)) }
        NSWorkspace.shared.activateFileViewerSelecting(urls)
    case "open":
        guard inputs.count == 1, let path = inputs.first else { throw failure("Select one file to open") }
        guard NSWorkspace.shared.open(URL(fileURLWithPath: try store.canonical(path))) else { throw failure("macOS could not open the file") }
    case "choose":
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        app.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Add files"
        if panel.runModal() == .OK { try store.add(panel.urls.map(\.path)) }
    default: throw failure("Unknown Files action: \(request.action)")
    }
    let files = try store.access().map(describe)
    FileHandle.standardOutput.write(try JSONEncoder().encode(files))
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
