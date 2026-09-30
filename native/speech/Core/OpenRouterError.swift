import Foundation

public enum OpenRouterError: Error, LocalizedError, Equatable, Sendable {
    case transcriptionFailed(primary: String, fallback: String)
    case missingAPIKey
    case emptyAudio
    case audioTooLarge
    case unsupportedAudioFormat(String)
    case invalidLanguage
    case invalidModel
    case invalidResponse
    case emptyTranscript
    case truncatedResponse
    case provider(status: Int, message: String, retryAfter: String?, context: String? = nil)

    public var errorDescription: String? {
        switch self {
        case .transcriptionFailed(let primary, let fallback):
            return "\(primary) Fallback also failed. \(fallback)"
        case .missingAPIKey:
            return "Add your OpenRouter API key in Settings."
        case .emptyAudio:
            return "The recording is empty. Try recording again."
        case .audioTooLarge:
            return "This recording exceeds 25 MB. Record a shorter dictation."
        case .unsupportedAudioFormat(let format):
            return "The transcription model does not support \(format) audio. Use WAV, MP3, or FLAC."
        case .invalidLanguage:
            return "Choose automatic language detection or a supported language code."
        case .invalidModel:
            return "Enter an OpenRouter model ID in Settings."
        case .invalidResponse:
            return "OpenRouter returned a response BuddyTalk could not read. Try again."
        case .emptyTranscript:
            return "No speech was returned. Check your microphone and try again."
        case .truncatedResponse:
            return "The model returned an incomplete result. Your original text has been kept."
        case .provider(let status, let message, _, let context):
            let explanation = switch status {
            case 401: "Your OpenRouter API key was rejected. Check it in Settings."
            case 402: "Your OpenRouter account needs credits."
            case 429: "OpenRouter is rate limiting requests. Wait a moment and try again."
            case 500...599: "The provider is unavailable. Try again shortly."
            default: "OpenRouter error \(status): \(message)"
            }
            return context.map { "\($0) failed. \(explanation)" } ?? explanation
        }
    }
}
