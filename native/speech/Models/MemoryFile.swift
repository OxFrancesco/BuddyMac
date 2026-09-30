import Foundation

struct MemoryFile {
    static let maximumBytes = 32_768
    let url: URL

    func read() throws -> String {
        guard FileManager.default.fileExists(atPath: url.path) else { return "" }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: Self.maximumBytes + 1) ?? Data()
        guard data.count <= Self.maximumBytes else { throw MemoryError.tooLarge }
        guard let text = String(data: data, encoding: .utf8) else { throw MemoryError.encoding }
        return text
    }

    func save(_ text: String) throws {
        guard text.utf8.count <= Self.maximumBytes else { throw MemoryError.tooLarge }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try Data(text.utf8).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    enum MemoryError: LocalizedError {
        case tooLarge, encoding
        var errorDescription: String? {
            switch self {
            case .tooLarge: "Keep memory.md under 32 KB."
            case .encoding: "Save memory.md as UTF-8 text."
            }
        }
    }
}
