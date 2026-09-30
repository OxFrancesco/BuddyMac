import Foundation
import Security
import SwiftData

package enum NotchFlowStoreError: Error, LocalizedError {
    case missingApplicationSupportDirectory

    package var errorDescription: String? {
        switch self {
        case .missingApplicationSupportDirectory:
            "Unable to resolve the Application Support directory."
        }
    }
}

package final class NotchFlowStore {
    package static let defaultCloudKitContainerIdentifier = "iCloud.com.avg-francesco.NotchFlow"

    package let container: ModelContainer
    package private(set) var mainContext: ModelContext
    package let storeURL: URL

    package init(
        url: URL? = nil,
        cloudKitContainerIdentifier: String? = NotchFlowStore.availableCloudKitContainerIdentifier()
    ) throws {
        let resolvedURL = try url ?? StoreLocation.defaultURL()
        storeURL = resolvedURL

        let schema = Schema([
            TaskRecord.self,
            FocusSessionRecord.self,
            DailyCheckInRecord.self,
            AppStateRecord.self,
        ])
        let cloudKitDatabase: ModelConfiguration.CloudKitDatabase = if let cloudKitContainerIdentifier {
            .private(cloudKitContainerIdentifier)
        } else {
            .none
        }
        let configuration = ModelConfiguration(schema: schema, url: resolvedURL, cloudKitDatabase: cloudKitDatabase)
        container = try ModelContainer(for: schema, configurations: configuration)
        mainContext = ModelContext(container)
        mainContext.autosaveEnabled = false
    }

    /// A fresh context sees writes that other processes made since the last request.
    package func resetContext() {
        mainContext = ModelContext(container)
        mainContext.autosaveEnabled = false
    }

    package static func entitledCloudKitContainer() -> String? { availableCloudKitContainerIdentifier() }

    private static func availableCloudKitContainerIdentifier() -> String? {
        let identifier = defaultCloudKitContainerIdentifier
        return currentProcessHasICloudEntitlement(for: identifier) ? identifier : nil
    }

    private static func currentProcessHasICloudEntitlement(for identifier: String) -> Bool {
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(
                task,
                "com.apple.developer.icloud-container-identifiers" as CFString,
                nil
              ) else {
            return false
        }

        if let containers = value as? [String] {
            return containers.contains(identifier)
        }

        if let container = value as? String {
            return container == identifier
        }

        return false
    }
}
