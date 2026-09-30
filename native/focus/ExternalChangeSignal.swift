import Foundation

package enum ExternalChangeSignal {
    package static let name = Notification.Name("com.avg-francesco.NotchFlow.externalStoreChange")

    package static func post() {
        DistributedNotificationCenter.default().postNotificationName(
            name, object: nil, userInfo: nil, deliverImmediately: true
        )
    }
}
