import Foundation

package struct TaskItem: Codable, Identifiable, Hashable, Sendable {
    package let id: UUID
    package var title: String
    package var notes: String
    package var projectName: String
    package var tags: [String]
    package var priority: TaskPriority
    package var dueDate: Date?
    package var isCompleted: Bool
    package var pomodorosCompleted: Int
    package var orderIndex: Int
    package let createdAt: Date

    package init(
        id: UUID = UUID(),
        title: String,
        notes: String = "",
        projectName: String = "",
        tags: [String] = [],
        priority: TaskPriority = .p3,
        dueDate: Date? = nil,
        isCompleted: Bool = false,
        pomodorosCompleted: Int = 0,
        orderIndex: Int = 0,
        createdAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.notes = notes
        self.projectName = projectName
        self.tags = tags
        self.priority = priority
        self.dueDate = dueDate
        self.isCompleted = isCompleted
        self.pomodorosCompleted = pomodorosCompleted
        self.orderIndex = orderIndex
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case notes
        case projectName
        case tags
        case priority
        case dueDate
        case isCompleted
        case pomodorosCompleted
        case orderIndex
        case createdAt
    }

    package init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        title = try container.decode(String.self, forKey: .title)
        notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
        projectName = try container.decodeIfPresent(String.self, forKey: .projectName) ?? ""
        tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        priority = try container.decodeIfPresent(TaskPriority.self, forKey: .priority) ?? .p3
        dueDate = try container.decodeIfPresent(Date.self, forKey: .dueDate)
        isCompleted = try container.decodeIfPresent(Bool.self, forKey: .isCompleted) ?? false
        pomodorosCompleted = try container.decodeIfPresent(Int.self, forKey: .pomodorosCompleted) ?? 0
        orderIndex = try container.decodeIfPresent(Int.self, forKey: .orderIndex) ?? 0
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? .now
    }
}
