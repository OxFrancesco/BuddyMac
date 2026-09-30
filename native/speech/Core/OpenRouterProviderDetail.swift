import Foundation

struct OpenRouterProviderDetail {
    let message: String
    let provider: String?

    init(data: Data) {
        let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let error = envelope?["error"] as? [String: Any]
        let metadata = error?["metadata"] as? [String: Any]
        provider = Self.nonempty(metadata?["provider_name"] as? String)
        message = Self.rawMessage(metadata?["raw"])
            ?? Self.nonempty(error?["message"] as? String)
            ?? "The provider rejected this request."
    }

    private static func rawMessage(_ raw: Any?) -> String? {
        if let object = raw as? [String: Any] { return message(in: object) }
        guard let text = nonempty(raw as? String) else { return nil }
        if let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] {
            return message(in: object)
        }
        guard !text.hasPrefix("{"), !text.hasPrefix("["), !text.contains("<") else { return nil }
        return text
    }

    private static func message(in object: [String: Any]) -> String? {
        let error = object["error"] as? [String: Any]
        return nonempty(error?["message"] as? String)
            ?? nonempty(object["message"] as? String)
            ?? nonempty(object["detail"] as? String)
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}
