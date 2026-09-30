import CryptoKit
import Foundation

public enum S1MiniModel {
    public static let revision = "34add00a48a2e5d24e5a4ee5405a99620a3a240c"
    public static let filename = "s1-mini-q4_k_m.gguf"
    public static let size: Int64 = 484_219_808
    public static let sha256 = "3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634"
    public static let downloadURL = URL(string: "https://huggingface.co/superwhisper/s1-mini-GGUF/resolve/\(revision)/\(filename)")!

    public static func verify(_ url: URL) throws {
        let url = url.resolvingSymlinksInPath()
        guard FileManager.default.fileExists(atPath: url.path) else { throw S1MiniError.missingModel }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard (attributes[.size] as? NSNumber)?.int64Value == size else { throw S1MiniError.invalidDownload }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hash = SHA256()
        while let data = try file.read(upToCount: 1_048_576), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
        }
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
