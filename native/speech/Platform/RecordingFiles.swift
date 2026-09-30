import Foundation

struct RecordingFiles {
    let directory = LocalStore().url.deletingLastPathComponent().appendingPathComponent("Recordings", isDirectory: true)

    func create() throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent("buddymac-\(UUID().uuidString).wav")
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        return url
    }
}
