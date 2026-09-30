import AppKit
import Foundation

struct Browser: Encodable {
    let name: String
    let bundleIdentifier: String
    let path: String
}

do {
    guard let probe = URL(string: "https://example.invalid"),
          let application = NSWorkspace.shared.urlForApplication(toOpen: probe),
          let bundle = Bundle(url: application),
          let identifier = bundle.bundleIdentifier else {
        throw NSError(domain: "BuddyMac", code: 1, userInfo: [NSLocalizedDescriptionKey: "macOS has no default web browser configured"])
    }
    let name = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
        ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
        ?? application.deletingPathExtension().lastPathComponent
    FileHandle.standardOutput.write(try JSONEncoder().encode(Browser(name: name, bundleIdentifier: identifier, path: application.path)))
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
