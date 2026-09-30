import Foundation

package struct DailyFocusSummary: Identifiable, Hashable, Sendable {
    package var id: Date { date }
    package let date: Date
    package let focusMinutes: Int
    package let sessionsCompleted: Int

    package init(date: Date, focusMinutes: Int, sessionsCompleted: Int) {
        self.date = date
        self.focusMinutes = focusMinutes
        self.sessionsCompleted = sessionsCompleted
    }
}
