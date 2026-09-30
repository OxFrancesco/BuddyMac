import Foundation

package enum TaskFilter: String, CaseIterable, Identifiable, Sendable {
    case today
    case upcoming
    case inbox
    case priority
    case all
    case completed

    package var id: String { rawValue }

    package var title: String {
        switch self {
        case .today:
            "Today"
        case .upcoming:
            "Upcoming"
        case .inbox:
            "Inbox"
        case .priority:
            "Priority"
        case .all:
            "All"
        case .completed:
            "Done"
        }
    }

    package func matches(_ task: TaskItem, calendar: Calendar = .current) -> Bool {
        switch self {
        case .today:
            guard !task.isCompleted else { return false }
            guard let dueDate = task.dueDate else { return false }
            return calendar.isDateInToday(dueDate) || dueDate < calendar.startOfDay(for: .now)
        case .upcoming:
            guard !task.isCompleted else { return false }
            guard let dueDate = task.dueDate else { return false }
            return dueDate > calendar.startOfDay(for: .now) && !calendar.isDateInToday(dueDate)
        case .inbox:
            return !task.isCompleted && task.projectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .priority:
            return !task.isCompleted && task.priority.rank <= 2
        case .all:
            return !task.isCompleted
        case .completed:
            return task.isCompleted
        }
    }
}
