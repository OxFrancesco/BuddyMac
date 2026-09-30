#!/usr/bin/env swift

import AppKit
import Foundation

struct ApplyRequest: Codable {
    let appPath: String
    let iconPath: String?
}

struct ApplyResult: Codable {
    let appPath: String
    let applied: Bool
    let error: String?
    let running: Bool
    let changed: Bool
}

func runningApp(_ path: String) -> NSRunningApplication? {
    let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
    return NSWorkspace.shared.runningApplications.first {
        $0.bundleURL?.resolvingSymlinksInPath() == url && !$0.isTerminated
    }
}

func result(_ path: String, _ applied: Bool, _ error: String? = nil, changed: Bool = false) -> ApplyResult {
    ApplyResult(appPath: path, applied: applied, error: error, running: runningApp(path) != nil, changed: changed)
}

enum ApplierError: Error, CustomStringConvertible {
    case usage
    case invalidInput

    var description: String {
        switch self {
        case .usage:
            return "Usage: DockApplier.swift <apply|apply-missing|reset|status> < requests.json"
        case .invalidInput:
            return "Expected a JSON array of { appPath, iconPath } objects on stdin"
        }
    }
}

// True when the bundle carries a complete Finder custom icon: the FinderInfo
// kHasCustomIcon bit is set and the Icon\r resource fork holds data.
func hasCompleteCustomIcon(_ appPath: String) -> Bool {
    let iconFile = "\(appPath)/Icon\r"
    let forkSize = (try? FileManager.default.attributesOfItem(atPath: "\(iconFile)/..namedfork/rsrc")[.size] as? Int) ?? 0
    guard forkSize > 0 else { return false }
    var buffer = [UInt8](repeating: 0, count: 32)
    let read = getxattr(appPath, "com.apple.FinderInfo", &buffer, 32, 0, 0)
    return read >= 10 && (buffer[8] & 0x04) != 0
}

func iconPixels(_ image: NSImage) -> Data? {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 128, pixelsHigh: 128,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 512, bitsPerPixel: 32),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = context
    image.draw(in: NSRect(x: 0, y: 0, width: 128, height: 128), from: .zero, operation: .copy, fraction: 1)
    return bitmap.representation(using: .png, properties: [:])
}

func matchesIcon(_ appPath: String, _ expected: NSImage) -> Bool {
    guard let stored = storedIcon(appPath), let pixels = iconPixels(expected), let installed = iconPixels(stored) else {
        return false
    }
    return installed == pixels
}

// IconServices can rasterize the same stored artwork differently. Read the icns
// resource to compare saved artwork without treating the visible Dock as verified.
func storedIcon(_ appPath: String) -> NSImage? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: "\(appPath)/Icon\r/..namedfork/rsrc")), data.count >= 16 else { return nil }
    func uint32(_ offset: Int) -> Int {
        data[offset..<offset + 4].reduce(0) { ($0 << 8) | Int($1) }
    }
    let start = uint32(0)
    let length = uint32(8)
    guard start >= 16, start <= data.count, length <= data.count - start else { return nil }
    let end = start + length
    var cursor = start
    while cursor <= end - 4 {
        let count = uint32(cursor)
        cursor += 4
        guard count <= end - cursor else { return nil }
        if count >= 8, data[cursor..<cursor + 4] == Data("icns".utf8) {
            return NSImage(data: data.subdata(in: cursor..<cursor + count))
        }
        cursor += count
    }
    return nil
}

func iconStatus(_ request: ApplyRequest) -> ApplyResult {
    guard hasCompleteCustomIcon(request.appPath) else {
        return result(request.appPath, false, "custom icon missing")
    }
    guard let path = request.iconPath else { return result(request.appPath, true) }
    guard let expected = NSImage(contentsOfFile: path) else {
        return result(request.appPath, false, "could not load requested icon")
    }
    let matches = matchesIcon(request.appPath, expected)
    return result(request.appPath, matches, matches ? nil : "stored custom icon differs from requested artwork")
}

func setIcon(_ request: ApplyRequest, reset: Bool, onlyMissing: Bool) -> ApplyResult {
    guard FileManager.default.fileExists(atPath: request.appPath) else {
        return result(request.appPath, false, "App not found")
    }
    let appURL = URL(fileURLWithPath: request.appPath).resolvingSymlinksInPath()
    let owner = (try? FileManager.default.attributesOfItem(atPath: appURL.path)[.ownerAccountID] as? NSNumber)?.uint32Value
    guard appURL.pathExtension == "app", owner == getuid() else {
        return result(request.appPath, false, "Only applications owned by your account can be changed in BuddyMac")
    }
    if onlyMissing && !reset && iconStatus(request).applied {
        return result(request.appPath, true)
    }
    // A denied write still strips the existing icon, so never attempt one we know will fail.
    guard FileManager.default.isWritableFile(atPath: request.appPath) else {
        let owner = (try? FileManager.default.attributesOfItem(atPath: request.appPath)[.ownerAccountName] as? String) ?? "?"
        return result(request.appPath, false, owner == NSUserName()
            ? "write denied by macOS App Management; grant it to this process (System Settings > Privacy & Security > App Management)"
            : "owned by \(owner); use buddydock reapply --sudo from an interactive terminal")
    }

    var image: NSImage? = nil
    if !reset {
        guard let iconPath = request.iconPath, let loaded = NSImage(contentsOfFile: iconPath) else {
            return result(request.appPath, false, "Could not load icon \(request.iconPath ?? "<none>")")
        }
        image = loaded
    }

    var ok = NSWorkspace.shared.setIcon(image, forFile: request.appPath, options: [])
    if !ok {
        // Finder occasionally rejects the first write right after a bundle was replaced.
        Thread.sleep(forTimeInterval: 0.5)
        ok = NSWorkspace.shared.setIcon(image, forFile: request.appPath, options: [])
    }
    let verified = reset ? !hasCompleteCustomIcon(request.appPath) : iconStatus(request).applied
    return result(request.appPath, ok && verified,
        !ok ? "NSWorkspace.setIcon returned false" : !verified ? "Custom icon artwork verification failed" : nil,
        changed: ok && verified)
}


do {
    guard CommandLine.arguments.count == 2, ["apply", "apply-missing", "reset", "status"].contains(CommandLine.arguments[1]) else {
        throw ApplierError.usage
    }
    let reset = CommandLine.arguments[1] == "reset"
    let onlyMissing = CommandLine.arguments[1] == "apply-missing"

    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let requests = try? JSONDecoder().decode([ApplyRequest].self, from: input) else {
        throw ApplierError.invalidInput
    }

    let results = requests.map { request in
        switch CommandLine.arguments[1] {
        case "status":
            return iconStatus(request)
        default:
            return setIcon(request, reset: reset, onlyMissing: onlyMissing)
        }
    }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(results))
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("buddydock: \(error)\n".utf8))
    exit(1)
}
