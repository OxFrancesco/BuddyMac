import Foundation

enum VoiceVocabulary {
    static func terms(from text: String) -> [String] {
        var seen = Set<String>()
        var terms: [String] = []

        for component in text.components(separatedBy: CharacterSet(charactersIn: "\n,;")) {
            let term = component.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !term.isEmpty,
                  term.count < 50,
                  term.split(whereSeparator: { $0.isWhitespace }).count <= 5,
                  term.rangeOfCharacter(from: CharacterSet(charactersIn: "<>{}[]\\")) == nil
            else { continue }

            let comparisonKey = term.folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: .current
            )
            guard seen.insert(comparisonKey).inserted else { continue }

            terms.append(term)
            if terms.count == 1_000 { break }
        }

        return terms
    }

    static func promptSection(from terms: [String]) -> String {
        guard !terms.isEmpty else { return "" }
        return """

        Preferred vocabulary and spellings:
        \(terms.map { "- \($0)" }.joined(separator: "\n"))
        Use these spellings when they are phonetically relevant. Never insert a vocabulary term that was not spoken.
        """
    }
}
