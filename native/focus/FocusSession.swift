import Foundation

package struct FocusSession: Codable, Identifiable, Hashable, Sendable {
    package let id: UUID
    package let taskID: UUID?
    package let taskTitle: String
    package let phase: PomodoroPhase
    package let finishedAt: Date
    package let durationSeconds: Int

    package init(
        id: UUID = UUID(),
        taskID: UUID?,
        taskTitle: String,
        phase: PomodoroPhase,
        finishedAt: Date = .now,
        durationSeconds: Int
    ) {
        self.id = id
        self.taskID = taskID
        self.taskTitle = taskTitle
        self.phase = phase
        self.finishedAt = finishedAt
        self.durationSeconds = durationSeconds
    }
}
