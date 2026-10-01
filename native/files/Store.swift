import Foundation
import Darwin

struct BucketStore {
    let directory: URL
    init() {
        let root = ProcessInfo.processInfo.environment["BUDDYMAC_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/BuddyMac")
        directory = root.appendingPathComponent("Files")
    }
    func canonical(_ path: String) throws -> String {
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL.resolvingSymlinksInPath()
        guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
            throw NSError(domain: "Bucket", code: 1, userInfo: [NSLocalizedDescriptionKey: "Not a regular file: \(path)"])
        }
        return url.path
    }
    func access(_ mutation: ((inout [String]) throws -> Void)? = nil) throws -> [String] {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let fd = Darwin.open(directory.appendingPathComponent("manifest.lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { flock(fd, LOCK_UN); close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        let file = directory.appendingPathComponent("manifest.json")
        var paths = [String]()
        if FileManager.default.fileExists(atPath: file.path) {
            paths = try JSONDecoder().decode([String].self, from: Data(contentsOf: file))
        } else {
            try JSONEncoder().encode(paths).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
        if let mutation {
            try mutation(&paths)
            try JSONEncoder().encode(paths).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
        return paths
    }
    func add(_ inputs: [String]) throws {
        let valid = try inputs.map(canonical)
        _ = try access { paths in for path in valid where !paths.contains(path) { paths.append(path) } }
    }
    func legacyPaths() throws -> [String] {
        let source = ProcessInfo.processInfo.environment["BUDDYMAC_LEGACY_FILES_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/FileDropBucket")
        let file = source.appendingPathComponent("manifest.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        let fd = Darwin.open(source.appendingPathComponent("manifest.lock").path, O_RDONLY)
        if fd >= 0 {
            guard flock(fd, LOCK_SH) == 0 else { close(fd); throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        }
        defer { if fd >= 0 { flock(fd, LOCK_UN); close(fd) } }
        let inputs = try JSONDecoder().decode([String].self, from: Data(contentsOf: file))
        var paths = [String]()
        for input in inputs {
            let path = (try? canonical(input)) ?? input
            if !paths.contains(path) { paths.append(path) }
        }
        return paths
    }
}
