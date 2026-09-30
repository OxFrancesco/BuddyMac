import Foundation

package enum StoreLocation {
    package static func defaultURL(fileManager: FileManager = .default) throws -> URL {
        let supportURL = try applicationSupportDirectory(fileManager: fileManager)
        return supportURL.appendingPathComponent("NotchFlow.store")
    }

    package static func applicationSupportDirectory(fileManager: FileManager = .default) throws -> URL {
        guard let supportURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw NotchFlowStoreError.missingApplicationSupportDirectory
        }

        let directoryURL = supportURL.appendingPathComponent("NotchFlow", isDirectory: true)
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        return directoryURL
    }
}
