import Foundation

enum OutputMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case replaceSelection
    case copyToClipboard

    var id: Self { self }

    var title: String {
        switch self {
        case .replaceSelection:
            "Replace Selected Text"
        case .copyToClipboard:
            "Copy To Clipboard"
        }
    }
}

enum VoiceTranscriptionProvider: String, Codable, CaseIterable, Identifiable, Sendable {
    case automatic
    case apple
    case elevenLabs
    case whisper

    var id: Self { self }

    var title: String {
        switch self {
        case .automatic: "Automatic"
        case .apple: "Apple"
        case .elevenLabs: "ElevenLabs"
        case .whisper: "Whisper"
        }
    }

    var summary: String {
        switch self {
        case .automatic:
            "Prefer Apple on-device speech, then ElevenLabs, then the downloaded Whisper model."
        case .apple:
            "Private, on-device transcription with Apple SpeechAnalyzer."
        case .elevenLabs:
            "Highest-accuracy cloud transcription with ElevenLabs Scribe v2."
        case .whisper:
            "Fully local transcription using the selected downloaded Whisper model."
        }
    }
}

enum VoiceLocaleDefaults {
    static var identifier: String {
        normalizedIdentifier(Locale.preferredLanguages.first ?? Locale.autoupdatingCurrent.identifier)
    }

    static func normalizedIdentifier(_ identifier: String) -> String {
        let locale = Locale(identifier: identifier)
        guard locale.language.languageCode?.identifier.lowercased() == "en" else {
            return identifier
        }

        let supportedEnglishRegions: Set<String> = ["AU", "CA", "GB", "IE", "IN", "NZ", "US", "ZA"]
        let region = locale.region?.identifier.uppercased()
        guard let region, supportedEnglishRegions.contains(region) else {
            return "en-US"
        }
        return "en-\(region)"
    }
}

enum RewriteProviderKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case openRouter
    case local

    var id: Self { self }

    var title: String {
        switch self {
        case .openRouter:
            "OpenRouter"
        case .local:
            "Local Models"
        }
    }
}

enum OpenRouterModel {
    static let defaultID = OpenRouterClient.defaultTextModel
}

struct OpenRouterModelSummary: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let name: String
    let contextLength: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case contextLength = "context_length"
    }

    var displayName: String {
        name.isEmpty ? id : name
    }
}

enum LocalModelID: String, Codable, CaseIterable, Identifiable, Sendable {
    case qwen3_4b_instruct_2507_4bit
    case gemma4_e4b_it_mxfp8

    var id: Self { self }

    var title: String {
        switch self {
        case .qwen3_4b_instruct_2507_4bit:
            "Qwen 4B Fast"
        case .gemma4_e4b_it_mxfp8:
            "Gemma 4 E4B"
        }
    }

    var repositoryID: String {
        switch self {
        case .qwen3_4b_instruct_2507_4bit:
            "mlx-community/Qwen3-4B-Instruct-2507-4bit"
        case .gemma4_e4b_it_mxfp8:
            "mlx-community/gemma-4-e4b-it-mxfp8"
        }
    }

    var summary: String {
        switch self {
        case .qwen3_4b_instruct_2507_4bit:
            "Smallest local model. Best default for instant grammar fixes."
        case .gemma4_e4b_it_mxfp8:
            "Heavier multilingual fallback. Better kept for benchmarking."
        }
    }

    var badge: String {
        switch self {
        case .qwen3_4b_instruct_2507_4bit:
            "~2.1 GB"
        case .gemma4_e4b_it_mxfp8:
            "~8.1 GB"
        }
    }

    var isAdvanced: Bool {
        switch self {
        case .qwen3_4b_instruct_2507_4bit:
            false
        case .gemma4_e4b_it_mxfp8:
            true
        }
    }
}

enum RewriteProvider: Hashable, Sendable {
    case openRouter(modelID: String)
    case local(modelID: LocalModelID)

    var kind: RewriteProviderKind {
        switch self {
        case .openRouter:
            .openRouter
        case .local:
            .local
        }
    }

    var modelLabel: String {
        switch self {
        case .openRouter(let modelID):
            modelID
        case .local(let modelID):
            modelID.title
        }
    }

    var localModelID: LocalModelID? {
        guard case .local(let modelID) = self else { return nil }
        return modelID
    }

    var openRouterModelID: String? {
        guard case .openRouter(let modelID) = self else { return nil }
        return modelID
    }
}

extension RewriteProvider: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind
        case modelID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(RewriteProviderKind.self, forKey: .kind)
        switch kind {
        case .openRouter:
            let modelID = try container.decodeIfPresent(String.self, forKey: .modelID) ?? OpenRouterModel.defaultID
            self = .openRouter(modelID: modelID)
        case .local:
            let modelID = try container.decodeIfPresent(LocalModelID.self, forKey: .modelID)
                ?? .qwen3_4b_instruct_2507_4bit
            self = .local(modelID: modelID)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        switch self {
        case .openRouter(let modelID):
            try container.encode(modelID, forKey: .modelID)
        case .local(let modelID):
            try container.encode(modelID, forKey: .modelID)
        }
    }
}

enum LocalModelState: String, Codable, Hashable, Sendable {
    case notDownloaded
    case downloading
    case ready
    case loading
    case loaded
    case failed

    var title: String {
        switch self {
        case .notDownloaded:
            "Not downloaded"
        case .downloading:
            "Downloading"
        case .ready:
            "Ready"
        case .loading:
            "Loading"
        case .loaded:
            "Loaded"
        case .failed:
            "Failed"
        }
    }
}

struct LocalModelStatus: Hashable, Sendable {
    var state: LocalModelState
    var progress: Double?
    var errorMessage: String?

    static let notDownloaded = LocalModelStatus(state: .notDownloaded, progress: nil, errorMessage: nil)
}

struct AppSettings: Codable, Hashable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case outputMode
        case rewriteProvider
        case selectedLocalModel
        case preloadLocalModelOnLaunch
        case voiceProfileID
        case voiceLocaleIdentifier
        case voiceTranscriptionProvider
        case voiceVocabulary
        case voiceFallbackModelID
        case voiceHotkey
        case launchAtLogin
        case hasCompletedOnboarding
    }

    var outputMode: OutputMode
    var rewriteProvider: RewriteProvider
    var selectedLocalModel: LocalModelID
    var preloadLocalModelOnLaunch: Bool
    var voiceProfileID: UUID?
    var voiceLocaleIdentifier: String?
    var voiceTranscriptionProvider: VoiceTranscriptionProvider
    var voiceVocabulary: String
    var voiceFallbackModelID: VoiceFallbackModelID
    var voiceHotkey: HotkeyDescriptor?
    var launchAtLogin: Bool
    var hasCompletedOnboarding: Bool

    init(
        outputMode: OutputMode,
        rewriteProvider: RewriteProvider,
        selectedLocalModel: LocalModelID,
        preloadLocalModelOnLaunch: Bool,
        voiceProfileID: UUID?,
        voiceLocaleIdentifier: String?,
        voiceHotkey: HotkeyDescriptor?,
        launchAtLogin: Bool,
        hasCompletedOnboarding: Bool,
        voiceTranscriptionProvider: VoiceTranscriptionProvider = .automatic,
        voiceVocabulary: String = "",
        voiceFallbackModelID: VoiceFallbackModelID = .whisperSmall
    ) {
        self.outputMode = outputMode
        self.rewriteProvider = rewriteProvider
        self.selectedLocalModel = selectedLocalModel
        self.preloadLocalModelOnLaunch = preloadLocalModelOnLaunch
        self.voiceProfileID = voiceProfileID
        self.voiceLocaleIdentifier = voiceLocaleIdentifier
        self.voiceTranscriptionProvider = voiceTranscriptionProvider
        self.voiceVocabulary = voiceVocabulary
        self.voiceFallbackModelID = voiceFallbackModelID
        self.voiceHotkey = voiceHotkey
        self.launchAtLogin = launchAtLogin
        self.hasCompletedOnboarding = hasCompletedOnboarding
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        outputMode = try container.decodeIfPresent(OutputMode.self, forKey: .outputMode) ?? .replaceSelection
        let decodedProvider = try container.decodeIfPresent(RewriteProvider.self, forKey: .rewriteProvider)
            ?? .openRouter(modelID: OpenRouterModel.defaultID)
        rewriteProvider = decodedProvider
        selectedLocalModel = try container.decodeIfPresent(LocalModelID.self, forKey: .selectedLocalModel)
            ?? decodedProvider.localModelID
            ?? .qwen3_4b_instruct_2507_4bit
        preloadLocalModelOnLaunch = try container.decodeIfPresent(Bool.self, forKey: .preloadLocalModelOnLaunch) ?? true
        voiceProfileID = try container.decodeIfPresent(UUID.self, forKey: .voiceProfileID) ?? PromptProfile.grammarProfileID
        let decodedVoiceLocale = try container.decodeIfPresent(String.self, forKey: .voiceLocaleIdentifier)
            ?? VoiceLocaleDefaults.identifier
        voiceLocaleIdentifier = VoiceLocaleDefaults.normalizedIdentifier(decodedVoiceLocale)
        voiceTranscriptionProvider = try container.decodeIfPresent(
            VoiceTranscriptionProvider.self,
            forKey: .voiceTranscriptionProvider
        ) ?? .automatic
        voiceVocabulary = try container.decodeIfPresent(String.self, forKey: .voiceVocabulary) ?? ""
        voiceFallbackModelID = try container.decodeIfPresent(
            VoiceFallbackModelID.self,
            forKey: .voiceFallbackModelID
        ) ?? .whisperSmall
        voiceHotkey = try container.decodeIfPresent(HotkeyDescriptor.self, forKey: .voiceHotkey)
        launchAtLogin = try container.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? false
        hasCompletedOnboarding = try container.decodeIfPresent(Bool.self, forKey: .hasCompletedOnboarding) ?? false
    }

    static let `default` = AppSettings(
        outputMode: .replaceSelection,
        rewriteProvider: .openRouter(modelID: OpenRouterModel.defaultID),
        selectedLocalModel: .qwen3_4b_instruct_2507_4bit,
        preloadLocalModelOnLaunch: true,
        voiceProfileID: PromptProfile.grammarProfileID,
        voiceLocaleIdentifier: VoiceLocaleDefaults.identifier,
        voiceHotkey: nil,
        launchAtLogin: false,
        hasCompletedOnboarding: false,
        voiceTranscriptionProvider: .automatic,
        voiceVocabulary: "",
        voiceFallbackModelID: .whisperSmall
    )
}

enum VoiceFallbackModelID: String, Codable, Sendable { case whisperBase, whisperSmall }
