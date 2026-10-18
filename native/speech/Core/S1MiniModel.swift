import CryptoKit
import Foundation

public enum S1MiniModel {
    public static let revision = "34add00a48a2e5d24e5a4ee5405a99620a3a240c"
    public static let filename = "s1-mini-q4_k_m.gguf"
    public static let size: Int64 = 484_219_808
    public static let sha256 = "3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634"
    public static let downloadURL = URL(string: "https://huggingface.co/superwhisper/s1-mini-GGUF/resolve/\(revision)/\(filename)")!

    /// Where a passing hash of `model` is remembered, next to the model in BuddyMac's own data.
    public static func verificationURL(for model: URL) -> URL {
        model.deletingLastPathComponent().appendingPathComponent(model.lastPathComponent + ".verified.json")
    }

    /// `remember` skips the multi-second 484 MB hash when the file still has the identity of one that passed before.
    public static func verify(_ url: URL, remember: Bool = false) throws {
        let record = verificationURL(for: url)
        let url = url.resolvingSymlinksInPath()
        guard FileManager.default.fileExists(atPath: url.path) else { throw S1MiniError.missingModel }
        let identity = try VerifiedFile(url)
        guard identity.size == size else { throw S1MiniError.invalidDownload }
        if remember, let data = try? Data(contentsOf: record),
           (try? JSONDecoder().decode(VerifiedFile.self, from: data)) == identity { return }
        try hash(url)
        if remember { try? identity.save(to: record) }
    }

    /// Records a file that was just hashed, such as a finished download moved into place.
    public static func remember(_ url: URL) {
        try? VerifiedFile(url.resolvingSymlinksInPath()).save(to: verificationURL(for: url))
    }

    private static func hash(_ url: URL) throws {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hash = SHA256()
        // Each chunk is autoreleased. Without a pool per chunk all 462 MB stay resident until the thread's pool drains.
        while try autoreleasepool(invoking: {
            guard let data = try file.read(upToCount: 1_048_576), !data.isEmpty else { return false }
            try Task.checkCancellation()
            hash.update(data: data)
            return true
        }) {}
        guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == sha256 else {
            throw S1MiniError.invalidDownload
        }
    }

    public static func download(to destination: URL, progress: @escaping @Sendable (Double) -> Void) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 3_600
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let delegate = DownloadProgress(update: progress)
        let (temporary, response) = try await session.download(from: downloadURL, delegate: delegate)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw S1MiniError.invalidDownload
        }
        try verify(temporary)
        try Task.checkCancellation()
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        remember(destination)
    }
}

/// Size, inode, device and nanosecond mtime change whenever the model is replaced or rewritten.
private struct VerifiedFile: Codable, Equatable {
    let path: String
    let size: Int64
    let inode: UInt64
    let device: Int32
    let modifiedSeconds: Int
    let modifiedNanoseconds: Int
    let sha256: String

    init(_ url: URL) throws {
        var info = stat()
        guard stat(url.path, &info) == 0 else { throw S1MiniError.missingModel }
        path = url.path
        size = Int64(info.st_size)
        inode = UInt64(info.st_ino)
        device = Int32(info.st_dev)
        modifiedSeconds = Int(info.st_mtimespec.tv_sec)
        modifiedNanoseconds = Int(info.st_mtimespec.tv_nsec)
        sha256 = S1MiniModel.sha256
    }

    func save(to url: URL) throws {
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

private final class DownloadProgress: NSObject, URLSessionDownloadDelegate, Sendable {
    let update: @Sendable (Double) -> Void

    init(update: @escaping @Sendable (Double) -> Void) { self.update = update }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        update(min(1, Double(totalBytesWritten) / Double(S1MiniModel.size)))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {}
}
