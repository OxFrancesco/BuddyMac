import Foundation

@MainActor
final class InferenceBridge {
    static let shared = InferenceBridge()
    nonisolated static var enabled: Bool { ProcessInfo.processInfo.environment["BUDDYMAC_PI_BRIDGE"] == "1" }
    private var pending: [String: CheckedContinuation<String, any Error>] = [:]

    func complete(system: String, input: String, model: String, screenshot: Data?) async throws -> String {
        let token = UUID().uuidString
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending[token] = continuation
                var event: [String: Any] = ["event": "inference", "token": token, "system": system, "input": input, "model": model]
                if let screenshot { event["screenshot"] = screenshot.base64EncodedString() }
                emit(event)
            }
        } onCancel: {
            Task { @MainActor in
                self.pending.removeValue(forKey: token)?.resume(throwing: CancellationError())
                self.emit(["event": "inferenceCancel", "token": token])
            }
        }
    }

    func resolve(token: String, text: String?, error: String?) {
        guard let continuation = pending.removeValue(forKey: token) else { return }
        if let error { continuation.resume(throwing: SpeechFailure(message: error)) }
        else if let text, !text.isEmpty { continuation.resume(returning: text) }
        else { continuation.resume(throwing: SpeechFailure(message: "The inference service returned no text.")) }
    }

    private func emit(_ event: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: event) { try? FileHandle.standardOutput.write(contentsOf: data + Data([10])) }
    }
}
