import Foundation

public enum S1MiniPrompt {
    public static let system = "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text."

    public static func make(_ transcript: String, style: DictationStyle) throws -> String {
        guard !transcript.contains("<|"), !transcript.contains("|>"),
              !transcript.contains("\0"), !transcript.contains("[Styling:") else {
            throw S1MiniError.unsupportedInput
        }
        let styling: String
        switch style {
        case .natural: styling = "semi-formal"
        case .casual: styling = "semi-casual"
        case .professional: styling = "formal"
        case .verbatim: throw S1MiniError.unsupportedInput
        }
        return "<|im_start|>system\n\(system)<|im_end|>\n<|im_start|>user\n[Styling: \(styling)] [Structure: lists] [Context: general]\n\(transcript)<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    }

    public static func supports(language: String, style: DictationStyle) -> Bool {
        language.lowercased().split(separator: "-").first == "en" && style != .verbatim
    }
}

public enum S1MiniError: Error, LocalizedError {
    case missingModel, invalidDownload, initialization, inference, tooLong, timedOut, unsupportedInput

    public var errorDescription: String? {
        switch self {
        case .missingModel: "Download S1-mini in Style to use local cleanup."
        case .invalidDownload: "The S1-mini download could not be verified. Download it again."
        case .initialization: "S1-mini could not load on this Mac."
        case .inference: "S1-mini did not return a complete transcript."
        case .tooLong: "This transcript exceeds S1-mini's 1,000-token limit."
        case .timedOut: "S1-mini took too long to clean up this transcript."
        case .unsupportedInput: "This transcript needs cloud cleanup."
        }
    }
}
