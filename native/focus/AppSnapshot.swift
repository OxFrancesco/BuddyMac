import Foundation

package struct AppSnapshot: Codable, Sendable {
    package var tasks: [TaskItem]
    package var selectedTaskID: UUID?
    package var activePhase: PomodoroPhase
    package var remainingSeconds: Int
    package var completedWorkSessions: Int
    package var settings: AppSettings
    package var sessionHistory: [FocusSession]
    package var checkIns: [DailyCheckIn]
    package var isRunning: Bool
    package var phaseEndDate: Date?

    package init(
        tasks: [TaskItem],
        selectedTaskID: UUID?,
        activePhase: PomodoroPhase,
        remainingSeconds: Int,
        completedWorkSessions: Int,
        settings: AppSettings,
        sessionHistory: [FocusSession],
        checkIns: [DailyCheckIn] = [],
        isRunning: Bool,
        phaseEndDate: Date? = nil
    ) {
        self.tasks = tasks
        self.selectedTaskID = selectedTaskID
        self.activePhase = activePhase
        self.remainingSeconds = remainingSeconds
        self.completedWorkSessions = completedWorkSessions
        self.settings = settings
        self.sessionHistory = sessionHistory
        self.checkIns = checkIns
        self.isRunning = isRunning
        self.phaseEndDate = phaseEndDate
    }
}
