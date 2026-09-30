import Foundation

public enum TextProcessor {
    public static func process(
        _ text: String,
        vocabulary: [VocabularyEntry] = [],
        snippets: [Snippet] = []
    ) -> String {
        apply(matches(in: text, vocabulary: vocabulary, snippets: snippets), to: text) { $0.target }
    }

    public static func protect(
        _ text: String,
        vocabulary: [VocabularyEntry] = [],
        snippets: [Snippet] = []
    ) -> ProtectedText {
        let matches = matches(in: text, vocabulary: vocabulary, snippets: snippets)
        let prefix = "BUDDYTALK_\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))_"
        var snippetExpansions: [String: String] = [:]
        let protected = apply(matches, to: text) { match in
            guard match.isSnippet else { return match.target }
            let marker = "\(prefix)\(snippetExpansions.count)_END"
            snippetExpansions[marker] = match.target
            return marker
        }
        return ProtectedText(
            text: protected, prefix: prefix, snippetExpansions: snippetExpansions, vocabulary: vocabulary,
            standaloneSnippet: matches.count == 1 && matches[0].isStandaloneSnippet
        )
    }

    private static func matches(
        in text: String,
        vocabulary: [VocabularyEntry],
        snippets: [Snippet]
    ) -> [ReplacementMatch] {
        let replacements = snippets.map { Replacement(source: $0.trigger, target: $0.expansion, isSnippet: true) }
            + vocabulary.map { Replacement(source: $0.spoken, target: $0.replacement, isSnippet: false) }
            + vocabulary.map { Replacement(source: $0.replacement, target: $0.replacement, isSnippet: false) }
        var uniqueSources = Set<String>()
        let ordered = replacements.compactMap { entry -> Replacement? in
            let source = entry.source.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !source.isEmpty, !entry.target.isEmpty,
                  uniqueSources.insert(source.lowercased()).inserted else { return nil }
            return Replacement(source: source, target: entry.target, isSnippet: entry.isSnippet)
        }.sorted { $0.source.count > $1.source.count }
        guard !ordered.isEmpty else { return [] }

        let source = text as NSString
        let fullRange = NSRange(location: 0, length: source.length)
        for entry in ordered where entry.isSnippet {
            let pattern = "^\\s*(?:\(phrasePattern(entry.source)))\\s*[.!?…]*\\s*$"
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
               regex.firstMatch(in: text, range: fullRange) != nil {
                return [ReplacementMatch(range: fullRange, target: entry.target, isSnippet: true, isStandaloneSnippet: true)]
            }
        }

        let patterns = ordered.map { entry in
            "(?<![\\p{L}\\p{M}\\p{N}_])(?:\(phrasePattern(entry.source)))(?![\\p{L}\\p{M}\\p{N}_])"
        }
        guard let regex = try? NSRegularExpression(
            pattern: patterns.map { "(\($0))" }.joined(separator: "|"),
            options: .caseInsensitive
        ) else { return [] }

        return regex.matches(in: text, range: fullRange).compactMap { match in
            guard let index = ordered.indices.first(where: { match.range(at: $0 + 1).location != NSNotFound }) else {
                return nil
            }
            return ReplacementMatch(
                range: match.range, target: ordered[index].target,
                isSnippet: ordered[index].isSnippet, isStandaloneSnippet: false
            )
        }
    }

    private static func phrasePattern(_ source: String) -> String {
        source.split(whereSeparator: \.isWhitespace)
            .map { NSRegularExpression.escapedPattern(for: String($0)) }
            .joined(separator: "[\\t ]+")
    }

    private static func apply(
        _ matches: [ReplacementMatch],
        to text: String,
        replacement: (ReplacementMatch) -> String
    ) -> String {
        let source = text as NSString
        var result = ""
        var cursor = 0
        for match in matches {
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            result += replacement(match)
            cursor = NSMaxRange(match.range)
        }
        result += source.substring(from: cursor)
        return result
    }

    private struct Replacement {
        let source: String
        let target: String
        let isSnippet: Bool
    }

    private struct ReplacementMatch {
        let range: NSRange
        let target: String
        let isSnippet: Bool
        let isStandaloneSnippet: Bool
    }
}

public struct ProtectedText: Sendable {
    public let text: String
    private let prefix: String
    private let snippetExpansions: [String: String]
    private let vocabulary: [VocabularyEntry]
    private let standaloneSnippet: Bool

    fileprivate init(
        text: String, prefix: String, snippetExpansions: [String: String],
        vocabulary: [VocabularyEntry], standaloneSnippet: Bool
    ) {
        self.text = text
        self.prefix = prefix
        self.snippetExpansions = snippetExpansions
        self.vocabulary = vocabulary
        self.standaloneSnippet = standaloneSnippet
    }

    public func restore(_ text: String) throws -> String {
        guard !snippetExpansions.isEmpty else { return TextProcessor.process(text, vocabulary: vocabulary) }
        if standaloneSnippet, let replacement = snippetExpansions.first {
            let pattern = "^\\s*\(NSRegularExpression.escapedPattern(for: replacement.key))\\s*[.!?…]*\\s*$"
            guard text.range(of: pattern, options: .regularExpression) != nil else {
                throw TextProcessingError.protectedTextChanged
            }
            return replacement.value
        }
        let pattern = "(?<![\\p{L}\\p{M}\\p{N}_])\(prefix)[\\p{L}\\p{M}\\p{N}_]+"
        let regex = try NSRegularExpression(pattern: pattern)
        let source = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: source.length))
        guard matches.count == snippetExpansions.count else { throw TextProcessingError.protectedTextChanged }
        var remaining = snippetExpansions
        var output = ""
        var cursor = 0
        for match in matches {
            let marker = source.substring(with: match.range)
            guard let replacement = remaining.removeValue(forKey: marker) else {
                throw TextProcessingError.protectedTextChanged
            }
            output += TextProcessor.process(
                source.substring(with: NSRange(location: cursor, length: match.range.location - cursor)),
                vocabulary: vocabulary
            )
            output += replacement
            cursor = NSMaxRange(match.range)
        }
        guard remaining.isEmpty else { throw TextProcessingError.protectedTextChanged }
        output += TextProcessor.process(source.substring(from: cursor), vocabulary: vocabulary)
        return output
    }
}

public enum TextProcessingError: Error, LocalizedError, Equatable, Sendable {
    case protectedTextChanged

    public var errorDescription: String? {
        "Cleanup changed a protected snippet. The original transcription was kept."
    }
}
