import Foundation

public struct VocabularyEntry: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var spoken: String
    public var replacement: String

    public init(id: UUID = UUID(), spoken: String, replacement: String) {
        self.id = id
        self.spoken = spoken
        self.replacement = replacement
    }
}

public struct Snippet: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var trigger: String
    public var expansion: String

    public init(id: UUID = UUID(), trigger: String, expansion: String) {
        self.id = id
        self.trigger = trigger
        self.expansion = expansion
    }
}

public enum DictationStyle: String, Codable, CaseIterable, Identifiable, Sendable {
    case natural, casual, professional, verbatim

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .natural: "Natural"
        case .casual: "Casual"
        case .professional: "Professional"
        case .verbatim: "Verbatim"
        }
    }
}

public struct CleanupSettings: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var style: DictationStyle
    public var model: String

    public init(
        enabled: Bool = true,
        style: DictationStyle = .natural,
        model: String = OpenRouterClient.defaultCleanupModel
    ) {
        self.enabled = enabled
        self.style = style
        self.model = model
    }
}

public struct TranscriptionRequest: Sendable {
    public var audio: Data
    public var fileName: String
    public var mimeType: String
    public var model: String
    public var language: String?
    public var vocabulary: [VocabularyEntry]
    public var verbatim: Bool

    public init(
        audio: Data,
        fileName: String = "dictation.wav",
        mimeType: String = "audio/wav",
        model: String = OpenRouterClient.defaultTranscriptionModel,
        language: String? = nil,
        vocabulary: [VocabularyEntry] = [],
        verbatim: Bool = false
    ) {
        self.audio = audio
        self.fileName = fileName
        self.mimeType = mimeType
        self.model = model
        self.language = language
        self.vocabulary = vocabulary
        self.verbatim = verbatim
    }
}

public struct TranscriptionResult: Equatable, Sendable {
    public let text: String
    public let costUSD: Double?
    public let durationSeconds: Double?

    public init(text: String, costUSD: Double? = nil, durationSeconds: Double? = nil) {
        self.text = text
        self.costUSD = costUSD
        self.durationSeconds = durationSeconds
    }
}
