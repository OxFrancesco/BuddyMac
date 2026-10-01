import Foundation
import Security
import LocalAuthentication

struct SpeechFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct WritingData: Codable {
    var settings = AppSettings.default
    var profiles = [PromptProfile.standard]
    var notes: [NoteItem] = []
}

struct SpeechStorage {
    let store = LocalStore()
    let writeURL: URL
    let importedDirectory: URL
    var data: StoredData
    var writing: WritingData
    var profiles: [PromptProfile] { writing.profiles }
    var writeModel: String { writing.settings.rewriteProvider.openRouterModelID ?? writing.settings.rewriteProvider.localModelID?.rawValue ?? "" }
    var writeProvider: String { writing.settings.rewriteProvider.kind.rawValue }
    var writingURL: URL { store.url.deletingLastPathComponent().appendingPathComponent("writing.json") }
    var modelURL: URL {
        store.url.deletingLastPathComponent().appendingPathComponent("models").appendingPathComponent(S1MiniModel.filename)
    }

    init() throws {
        let root = store.url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        importedDirectory = root.appendingPathComponent("Imported", isDirectory: true)
        writeURL = importedDirectory.appendingPathComponent("BuddyWrite.plist")
        try FileManager.default.createDirectory(at: importedDirectory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        data = try store.load()
        writing = WritingData()
        if FileManager.default.fileExists(atPath: writeURL.path) {
            let values = try PropertyListSerialization.propertyList(from: Data(contentsOf: writeURL), format: nil) as? [String: Data] ?? [:]
            if let bytes = values["BuddyGrammar.profiles"] {
                writing.profiles = try JSONDecoder().decode([PromptProfile].self, from: bytes)
            }
            if let bytes = values["BuddyGrammar.settings"] {
                writing.settings = try JSONDecoder().decode(AppSettings.self, from: bytes)
            }
            if let bytes = values["BuddyGrammar.notes"] {
                writing.notes = try JSONDecoder().decode([NoteItem].self, from: bytes)
            }
        }
        if FileManager.default.fileExists(atPath: writingURL.path) {
            writing = try JSONDecoder().decode(WritingData.self, from: Data(contentsOf: writingURL))
        }
        let defaultsMigration = root.appendingPathComponent("text-model-defaults-v1.json")
        if !FileManager.default.fileExists(atPath: defaultsMigration.path) {
            if ["", "google/gemini-2.5-flash-lite"].contains(data.preferences.cleanupModel.trimmingCharacters(in: .whitespacesAndNewlines)) {
                data.preferences.cleanupModel = OpenRouterClient.defaultTextModel
            }
            if case .openRouter(let model) = writing.settings.rewriteProvider,
               ["", "google/gemini-3.1-flash-lite"].contains(model.trimmingCharacters(in: .whitespacesAndNewlines)) {
                writing.settings.rewriteProvider = .openRouter(modelID: OpenRouterClient.defaultTextModel)
            }
            try save()
            try saveWriting()
            try Self.writePrivate(Data("1".utf8), to: defaultsMigration)
        }
    }

    func saveWriting() throws { try Self.writePrivate(JSONEncoder().encode(writing), to: writingURL) }

    static func writePrivate(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    func save() throws { try store.save(data) }
}

struct SpeechKeychain {
    private let isolated = ProcessInfo.processInfo.environment["BUDDYMAC_SPEECH_DATA_DIR"] != nil
    private let own = (service: "org.buddytools.BuddyMac", account: "openrouter-api-key")
    private var identities: [(service: String, account: String)] {
        isolated ? [] : [own]
    }

    private func query(_ identity: (service: String, account: String)) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: identity.service,
         kSecAttrAccount as String: identity.account]
    }

    func configured() -> Bool {
        identities.contains { identity in
            var attributes = query(identity)
            attributes[kSecReturnAttributes as String] = true
            let context = LAContext()
            context.interactionNotAllowed = true
            attributes[kSecUseAuthenticationContext as String] = context
            var result: CFTypeRef?
            let code = SecItemCopyMatching(attributes as CFDictionary, &result)
            return code == errSecSuccess || code == errSecInteractionNotAllowed
        }
    }

    func read() throws -> String {
        for identity in identities {
            var attributes = query(identity)
            attributes[kSecReturnData as String] = true
            attributes[kSecMatchLimit as String] = kSecMatchLimitOne
            let context = LAContext()
            context.interactionNotAllowed = true
            attributes[kSecUseAuthenticationContext as String] = context
            var result: CFTypeRef?
            let code = SecItemCopyMatching(attributes as CFDictionary, &result)
            if code == errSecItemNotFound { continue }
            guard code == errSecSuccess else { throw SpeechFailure(message: "Save your OpenRouter key in BuddyMac Talk settings to enable transcription and rewriting.") }
            if let bytes = result as? Data, let value = String(data: bytes, encoding: .utf8), !value.isEmpty { return value }
        }
        throw SpeechFailure(message: "Add an OpenRouter key before transcribing or rewriting.")
    }

    func remove() throws {
        guard !isolated else { throw SpeechFailure(message: "Keychain changes are disabled in isolated mode.") }
        let code = SecItemDelete(query(own) as CFDictionary)
        guard code == errSecSuccess || code == errSecItemNotFound else { throw SpeechFailure(message: "The key could not be removed from Keychain.") }
    }

    func save(_ value: String) throws {
        guard !isolated else { throw SpeechFailure(message: "Keychain changes are disabled in isolated mode.") }
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { throw SpeechFailure(message: "Enter an OpenRouter key.") }
        let attributes = query(own)
        let update = SecItemUpdate(attributes as CFDictionary, [kSecValueData as String: Data(key.utf8)] as CFDictionary)
        if update == errSecItemNotFound {
            var addition = attributes
            addition[kSecValueData as String] = Data(key.utf8)
            addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw SpeechFailure(message: "The key could not be saved in Keychain.") }
        } else if update != errSecSuccess { throw SpeechFailure(message: "The key could not be updated in Keychain.") }
    }
}
