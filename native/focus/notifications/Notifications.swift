import AppKit
import Foundation
import UserNotifications

private struct NotificationRequest: Decodable, Sendable {
    let operation: String
    var title: String?
    var message: String?
    var notification: Bool?
    var sound: Bool?
}

private final class NotificationReplies: @unchecked Sendable {
    static let shared = NotificationReplies()
    private let lock = NSLock()
    private var sequence: Int32 = 0
    private var pending: Set<Int32> = []
    private var replies: [Int32: String] = [:]

    func reserve() -> Int32 {
        lock.lock(); defer { lock.unlock() }
        sequence = sequence == Int32.max ? 1 : sequence + 1
        pending.insert(sequence)
        return sequence
    }
    func finish(_ id: Int32, _ reply: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: reply), let text = String(data: data, encoding: .utf8) else { return }
        lock.lock(); defer { lock.unlock() }
        if pending.contains(id) { replies[id] = text }
    }
    func take(_ id: Int32) -> UnsafeMutablePointer<CChar>? {
        lock.lock(); defer { lock.unlock() }
        guard let text = replies.removeValue(forKey: id) else { return nil }
        pending.remove(id)
        return strdup(text)
    }
    func cancel(_ id: Int32) {
        lock.lock(); defer { lock.unlock() }
        pending.remove(id); replies.removeValue(forKey: id)
    }
}

final class FocusNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = FocusNotificationDelegate()
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}

struct NotificationFailure: Error, Sendable {
    let message: String
    let domain: String
    let code: Int
    init(_ error: Error) {
        let error = error as NSError
        message = error.localizedDescription; domain = error.domain; code = error.code
    }
}

protocol NotificationBackend: Sendable {
    func authorize(_ completion: @escaping @Sendable (Bool, NotificationFailure?) -> Void)
    func authorizationStatus(_ completion: @escaping @Sendable (String) -> Void)
    func deliver(id: String, title: String, message: String, completion: @escaping @Sendable (NotificationFailure?) -> Void)
    func delivered(_ completion: @escaping @Sendable ([String]) -> Void)
    func playSound()
}

private final class SystemNotificationBackend: NotificationBackend, @unchecked Sendable {
    private let center = UNUserNotificationCenter.current()
    init() { center.delegate = FocusNotificationDelegate.shared }
    func authorize(_ completion: @escaping @Sendable (Bool, NotificationFailure?) -> Void) {
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in completion(granted, error.map(NotificationFailure.init)) }
    }
    func authorizationStatus(_ completion: @escaping @Sendable (String) -> Void) {
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined: completion("notDetermined")
            case .denied: completion("denied")
            case .authorized: completion("authorized")
            case .provisional: completion("provisional")
            @unknown default: completion("unknown")
            }
        }
    }
    func deliver(id: String, title: String, message: String, completion: @escaping @Sendable (NotificationFailure?) -> Void) {
        let content = UNMutableNotificationContent()
        content.title = title; content.body = message
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in completion(error.map(NotificationFailure.init)) }
    }
    func delivered(_ completion: @escaping @Sendable ([String]) -> Void) {
        center.getDeliveredNotifications { notifications in completion(notifications.map { $0.request.identifier }) }
    }
    func playSound() { NSSound(named: "Glass")?.play() }
}

private let notificationQueue = DispatchQueue(label: "org.buddytools.BuddyMac.notifications")

private func finishError(_ id: Int32, _ error: NotificationFailure) {
    NotificationReplies.shared.finish(id, ["ok": false, "error": error.message, "domain": error.domain, "code": error.code])
}

private func perform(_ request: NotificationRequest, id: Int32, backend: any NotificationBackend) {
    switch request.operation {
    case "authorize":
        backend.authorize { granted, error in
            if let error { finishError(id, error) }
            else if granted { NotificationReplies.shared.finish(id, ["ok": true]) }
            else { NotificationReplies.shared.finish(id, ["ok": false, "error": "Notifications are disabled for BuddyMac in macOS System Settings."]) }
        }
    case "notify":
        guard request.notification == true else {
            if request.sound == true { backend.playSound() }
            NotificationReplies.shared.finish(id, ["ok": true])
            return
        }
        backend.authorizationStatus { status in
            guard status == "authorized" || status == "provisional" else {
                NotificationReplies.shared.finish(id, ["ok": false, "error": "Enable Focus notifications in Settings to receive timer alerts."])
                return
            }
            let notificationID = "buddymac-focus-\(UUID().uuidString)"
            backend.deliver(id: notificationID, title: request.title ?? "Focus", message: request.message ?? "") { error in
                if let error { finishError(id, error); return }
                if request.sound == true { backend.playSound() }
                NotificationReplies.shared.finish(id, ["ok": true, "notificationID": notificationID])
            }
        }
    case "status":
        backend.authorizationStatus { status in
            backend.delivered { identifiers in
                NotificationReplies.shared.finish(id, ["ok": true, "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
                    "authorizationStatus": status, "deliveredIdentifiers": identifiers.filter { $0.hasPrefix("buddymac-focus-") }])
            }
        }
    default:
        NotificationReplies.shared.finish(id, ["ok": false, "error": "Unknown notification operation."])
    }
}

@_cdecl("buddymac_notifications_start")
public func startNotification(_ json: UnsafePointer<CChar>?) -> Int32 {
    let id = NotificationReplies.shared.reserve()
    do {
        guard let json else { throw CocoaError(.coderReadCorrupt) }
        let request = try JSONDecoder().decode(NotificationRequest.self, from: Data(String(cString: json).utf8))
        guard ["authorize", "notify", "status"].contains(request.operation) else { throw CocoaError(.coderReadCorrupt) }
        if ProcessInfo.processInfo.environment["BUDDYMAC_FOCUS_DISABLE_ALERTS"] == "1" {
            NotificationReplies.shared.finish(id, ["ok": true, "disabledForTest": true])
            return id
        }
        #if NOTIFICATIONS_TESTING
        notificationQueue.async { perform(request, id: id, backend: SyntheticNotificationBackend.shared) }
        #else
        guard Bundle.main.bundleIdentifier == "org.buddytools.BuddyMac", Bundle.main.bundleURL.pathExtension == "app" else {
            NotificationReplies.shared.finish(id, ["ok": false, "error": "Notifications must be requested from the running BuddyMac app."])
            return id
        }
        notificationQueue.async { perform(request, id: id, backend: SystemNotificationBackend()) }
        #endif
    } catch {
        NotificationReplies.shared.finish(id, ["ok": false, "error": "Invalid notification request."])
    }
    return id
}

@_cdecl("buddymac_notifications_take")
public func takeNotification(_ id: Int32) -> UnsafeMutablePointer<CChar>? { NotificationReplies.shared.take(id) }

@_cdecl("buddymac_notifications_cancel")
public func cancelNotification(_ id: Int32) { NotificationReplies.shared.cancel(id) }

@_cdecl("buddymac_notifications_free")
public func freeNotification(_ reply: UnsafeMutablePointer<CChar>?) { free(reply) }
