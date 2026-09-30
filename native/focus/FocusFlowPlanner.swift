import Foundation

package enum FocusFlowPlanner {
    package static func duration(for phase: PomodoroPhase, settings: AppSettings) -> Int {
        let minutes = switch phase {
        case .work:
            settings.workDurationMinutes
        case .shortBreak:
            settings.shortBreakMinutes
        case .longBreak:
            settings.longBreakMinutes
        }

        return minutes * 60
    }

    package static func nextPhase(after current: PomodoroPhase, completedWorkSessions: Int, settings: AppSettings) -> PomodoroPhase {
        switch current {
        case .work:
            if completedWorkSessions > 0 && completedWorkSessions.isMultiple(of: max(settings.longBreakEvery, 1)) {
                return .longBreak
            }

            return .shortBreak
        case .shortBreak, .longBreak:
            return .work
        }
    }

    package static func format(seconds: Int) -> String {
        let clamped = max(seconds, 0)
        let minutes = clamped / 60
        let remainingSeconds = clamped % 60
        return "\(minutes):\(String(format: "%02d", remainingSeconds))"
    }
}
