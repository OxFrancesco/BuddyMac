import Foundation

struct Preferences: Codable, Equatable {
    var screenContextEnabled = false
    var memoryEnabled = true
    var language = "auto"
    var cleanupEnabled = true
    var localCleanupEnabled = false
    var style = DictationStyle.natural
    var cleanupModel = OpenRouterClient.defaultCleanupModel
    var autoPaste = true
    var restoreClipboard = true
    var saveHistory = true
    var playSounds = false
    var launchAtLogin = false
    var shortcuts = ShortcutBindings()
    var vocabulary: [VocabularyEntry] = []
    var snippets: [Snippet] = []
    var appStyles: [AppStyleRule] = []

    init() {}

    private enum CodingKeys: String, CodingKey {
        case screenContextEnabled, memoryEnabled, localCleanupEnabled
        case language, cleanupEnabled, style, cleanupModel, autoPaste, restoreClipboard, saveHistory
        case playSounds, launchAtLogin, shortcuts, vocabulary, snippets, appStyles
    }

    private enum LegacyKeys: String, CodingKey { case shortcutPreset }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        screenContextEnabled = try values.decodeIfPresent(Bool.self, forKey: .screenContextEnabled) ?? false
        memoryEnabled = try values.decodeIfPresent(Bool.self, forKey: .memoryEnabled) ?? true
        language = try values.decodeIfPresent(String.self, forKey: .language) ?? language
        cleanupEnabled = try values.decodeIfPresent(Bool.self, forKey: .cleanupEnabled) ?? cleanupEnabled
        localCleanupEnabled = try values.decodeIfPresent(Bool.self, forKey: .localCleanupEnabled) ?? false
        style = try values.decodeIfPresent(DictationStyle.self, forKey: .style) ?? style
        cleanupModel = try values.decodeIfPresent(String.self, forKey: .cleanupModel) ?? cleanupModel
        autoPaste = try values.decodeIfPresent(Bool.self, forKey: .autoPaste) ?? autoPaste
        restoreClipboard = try values.decodeIfPresent(Bool.self, forKey: .restoreClipboard) ?? restoreClipboard
        saveHistory = try values.decodeIfPresent(Bool.self, forKey: .saveHistory) ?? saveHistory
        playSounds = try values.decodeIfPresent(Bool.self, forKey: .playSounds) ?? playSounds
        launchAtLogin = try values.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? launchAtLogin
        vocabulary = try values.decodeIfPresent([VocabularyEntry].self, forKey: .vocabulary) ?? []
        snippets = try values.decodeIfPresent([Snippet].self, forKey: .snippets) ?? []
        appStyles = try values.decodeIfPresent([AppStyleRule].self, forKey: .appStyles) ?? []
        let legacy = try decoder.container(keyedBy: LegacyKeys.self)
        shortcuts = try values.decodeIfPresent(ShortcutBindings.self, forKey: .shortcuts)
            ?? ShortcutBindings(preset: legacy.decodeIfPresent(String.self, forKey: .shortcutPreset) ?? "controlOption")
    }

    func style(for bundleID: String?) -> DictationStyle {
        appStyles.first { $0.bundleID == bundleID }?.style ?? style
    }
}

struct AppStyleRule: Codable, Identifiable, Equatable {
    var id = UUID()
    var bundleID: String
    var name: String
    var style: DictationStyle
}

struct HistoryEntry: Codable, Identifiable, Equatable {
    var id = UUID()
    var date = Date()
    var rawText: String
    var text: String
    var appName: String
    var duration: TimeInterval
}

struct StoredData: Codable {
    var preferences = Preferences()
    var history: [HistoryEntry] = []
}

struct LocalStore {
    let url: URL

    init() {
        let root = ProcessInfo.processInfo.environment["BUDDYMAC_SPEECH_DATA_DIR"].map {
            URL(fileURLWithPath: $0, isDirectory: true)
        } ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BuddyMac/Speech", isDirectory: true)
        url = root.appendingPathComponent("settings.json")
    }

    func load() throws -> StoredData {
        guard FileManager.default.fileExists(atPath: url.path) else { return StoredData() }
        return try JSONDecoder().decode(StoredData.self, from: Data(contentsOf: url))
    }

    func save(_ data: StoredData) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(data).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

enum DictationPhase: String, Equatable {
    case idle, requestingPermission, recording, transcribing, formatting, inserting, success, failed

    var title: String {
        switch self {
        case .idle: "Ready when you are"
        case .requestingPermission: "Waiting for microphone access"
        case .recording: "Listening"
        case .transcribing: "Transcribing"
        case .formatting: "Tidying up"
        case .inserting: "Inserting"
        case .success: "Done"
        case .failed: "Needs attention"
        }
    }

    var isBusy: Bool {
        [.requestingPermission, .recording, .transcribing, .formatting, .inserting].contains(self)
    }
}
