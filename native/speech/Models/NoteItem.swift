import Foundation

struct NoteItem: Codable, Equatable, Identifiable, Sendable {
    var id: UUID
    var title: String
    var content: String
    var hotkey: HotkeyDescriptor?
    var createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        title: String = "New Note",
        content: String = "",
        hotkey: HotkeyDescriptor? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.content = content
        self.hotkey = hotkey
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }

        let firstLine = content
            .split(whereSeparator: \.isNewline)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return firstLine?.isEmpty == false ? firstLine! : "Untitled Note"
    }

    var preview: String {
        let normalized = content
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? "No note text yet" : normalized
    }
}
