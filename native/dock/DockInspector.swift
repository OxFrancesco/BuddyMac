#!/usr/bin/env swift

import AppKit
import Foundation

struct DockIcon: Codable {
    let id: String
    let name: String
    let bundleIdentifier: String?
    let appPath: String
    let iconPath: String
}

enum InspectorError: Error, CustomStringConvertible {
    case usage
    case dockPreferencesUnavailable
    case imageEncodingFailed(String)

    var description: String {
        switch self {
        case .usage:
            return "Usage: DockInspector.swift <output-directory>"
        case .dockPreferencesUnavailable:
            return "Could not read the persistent-apps array from com.apple.dock"
        case .imageEncodingFailed(let app):
            return "Could not encode the icon for \(app)"
        }
    }
}

func slug(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics
    let parts = value.lowercased().unicodeScalars.map { allowed.contains($0) ? String($0) : "-" }
    return parts.joined().split(separator: "-").filter { !$0.isEmpty }.joined(separator: "-")
}

func appURL(from tile: [String: Any]) -> URL? {
    guard
        let tileData = tile["tile-data"] as? [String: Any],
        let fileData = tileData["file-data"] as? [String: Any],
        let rawURL = fileData["_CFURLString"] as? String
    else { return nil }

    if let url = URL(string: rawURL), url.isFileURL { return url }
    return URL(fileURLWithPath: rawURL)
}

// Prefer the icon shipped inside the bundle so a previously applied custom icon
// (Icon\r resource) is never used as the source for a new style.
func bundledIcon(for appURL: URL) -> NSImage? {
    guard let bundle = Bundle(url: appURL) else { return nil }

    let iconNames = ["CFBundleIconFile", "CFBundleIconName"].compactMap {
        bundle.object(forInfoDictionaryKey: $0) as? String
    }

    for iconName in iconNames {
        let value = iconName as NSString
        let name = value.deletingPathExtension
        let fileExtension = value.pathExtension.isEmpty ? "icns" : value.pathExtension

        if
            let iconURL = bundle.url(forResource: name, withExtension: fileExtension),
            let image = NSImage(contentsOf: iconURL)
        {
            return image
        }
    }

    return nil
}

func exportIcon(for appURL: URL, to destination: URL) throws {
    let image = bundledIcon(for: appURL) ?? NSWorkspace.shared.icon(forFile: appURL.path)
    image.size = NSSize(width: 1024, height: 1024)

    guard
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else { throw InspectorError.imageEncodingFailed(appURL.lastPathComponent) }

    try png.write(to: destination, options: .atomic)
}

do {
    guard CommandLine.arguments.count == 2 else { throw InspectorError.usage }

    let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

    guard
        let domain = UserDefaults.standard.persistentDomain(forName: "com.apple.dock"),
        let tiles = domain["persistent-apps"] as? [[String: Any]]
    else { throw InspectorError.dockPreferencesUnavailable }

    var icons: [DockIcon] = []
    for (index, tile) in tiles.enumerated() {
        guard let url = appURL(from: tile) else { continue }
        let resolvedURL = url.resolvingSymlinksInPath()
        guard FileManager.default.fileExists(atPath: resolvedURL.path) else { continue }

        let bundle = Bundle(url: resolvedURL)
        let name = (tile["tile-data"] as? [String: Any])?["file-label"] as? String
            ?? bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? resolvedURL.deletingPathExtension().lastPathComponent
        let identifier = bundle?.bundleIdentifier
        let id = identifier ?? "\(slug(name))-\(index)"
        let iconURL = outputDirectory.appendingPathComponent("\(String(format: "%02d", index + 1))-\(slug(name)).png")

        try exportIcon(for: resolvedURL, to: iconURL)
        icons.append(DockIcon(
            id: id,
            name: name,
            bundleIdentifier: identifier,
            appPath: resolvedURL.path,
            iconPath: iconURL.path
        ))
    }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(icons))
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("buddydock: \(error)\n".utf8))
    exit(1)
}
