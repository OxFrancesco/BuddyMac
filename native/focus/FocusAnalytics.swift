import Foundation

package enum FocusAnalytics {
    package static func focusSessions(from sessions: [FocusSession]) -> [FocusSession] {
        sessions.filter { $0.phase == .work }
    }

    package static func streak(for sessions: [FocusSession], calendar: Calendar = .current) -> Int {
        let groupedDates = Set(focusSessions(from: sessions).map { calendar.startOfDay(for: $0.finishedAt) })
        guard !groupedDates.isEmpty else { return 0 }

        var streak = 0
        var cursor = calendar.startOfDay(for: .now)

        while groupedDates.contains(cursor) {
            streak += 1
            guard let previousDay = calendar.date(byAdding: .day, value: -1, to: cursor) else {
                break
            }
            cursor = previousDay
        }

        return streak
    }

    package static func dailySummaries(for sessions: [FocusSession], days: Int = 7, calendar: Calendar = .current) -> [DailyFocusSummary] {
        let grouped = Dictionary(grouping: focusSessions(from: sessions)) { session in
            calendar.startOfDay(for: session.finishedAt)
        }

        let today = calendar.startOfDay(for: .now)

        return (0 ..< days).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else {
                return nil
            }

            let daySessions = grouped[day, default: []]
            let focusMinutes = daySessions.reduce(0) { partialResult, session in
                partialResult + (session.durationSeconds / 60)
            }

            return DailyFocusSummary(
                date: day,
                focusMinutes: focusMinutes,
                sessionsCompleted: daySessions.count
            )
        }
    }

    package static func weeklyFocusMinutes(for sessions: [FocusSession]) -> Int {
        dailySummaries(for: sessions, days: 7).reduce(0) { $0 + $1.focusMinutes }
    }

    package static func weeklySessions(for sessions: [FocusSession]) -> Int {
        dailySummaries(for: sessions, days: 7).reduce(0) { $0 + $1.sessionsCompleted }
    }

    package static func averageDailyFocusMinutes(for sessions: [FocusSession]) -> Int {
        let summaries = dailySummaries(for: sessions, days: 7)
        guard !summaries.isEmpty else { return 0 }
        return summaries.reduce(0) { $0 + $1.focusMinutes } / summaries.count
    }
}
