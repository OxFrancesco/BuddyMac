#if NOTIFICATIONS_TESTING
import Foundation

final class SyntheticNotificationBackend: NotificationBackend, @unchecked Sendable {
    static let shared = SyntheticNotificationBackend()
    private let lock = NSLock()
    private var identifiers: [String] = ["unrelated-fixture-notification"]
    private let scenario = ProcessInfo.processInfo.environment["BUDDYMAC_NOTIFICATION_SCENARIO"] ?? "success"
    private func later(_ callback: @escaping @Sendable () -> Void) {
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(30), execute: callback)
    }
    func authorize(_ completion: @escaping @Sendable (Bool, NotificationFailure?) -> Void) {
        later { [self] in
            if scenario == "authorizationError" {
                completion(false, NotificationFailure(NSError(domain: "SyntheticNotifications", code: 41, userInfo: [NSLocalizedDescriptionKey: "Synthetic authorization service failure"])))
            } else { completion(scenario != "denied", nil) }
        }
    }
    func authorizationStatus(_ completion: @escaping @Sendable (String) -> Void) {
        later { [self] in completion(scenario == "denied" ? "denied" : "authorized") }
    }
    func deliver(id: String, title: String, message: String, completion: @escaping @Sendable (NotificationFailure?) -> Void) {
        later { [self] in
            if scenario == "deliveryError" {
                completion(NotificationFailure(NSError(domain: "SyntheticNotifications", code: 42, userInfo: [NSLocalizedDescriptionKey: "Synthetic scheduling failure"])))
                return
            }
            lock.lock(); identifiers.append(id); lock.unlock()
            completion(nil)
        }
    }
    func delivered(_ completion: @escaping @Sendable ([String]) -> Void) {
        later { [self] in
            lock.lock(); let values = identifiers; lock.unlock()
            completion(values)
        }
    }
    func playSound() {}
}
#endif
