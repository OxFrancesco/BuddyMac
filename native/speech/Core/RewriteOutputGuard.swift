import Foundation

enum RewriteOutputGuard {
    private static let disallowedPrefixes = [
        "here is the corrected text",
        "here's the corrected text",
        "corrected text:",
        "the corrected text is",
        "grammar correction:",
        "fixed text:",
        "corrected version:",
        "here is the revised text",
        "here's the revised text"
    ]

    static func sanitize(_ output: String) throws -> String {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw SpeechFailure(message: "The writing provider returned an empty result or explanatory text. The source was not replaced.")
        }

        let normalized = trimmed
            .replacingOccurrences(of: "\u{2019}", with: "'")
            .lowercased()

        guard !disallowedPrefixes.contains(where: { normalized.hasPrefix($0) }) else {
            throw SpeechFailure(message: "The writing provider returned an empty result or explanatory text. The source was not replaced.")
        }

        return trimmed
    }
}
