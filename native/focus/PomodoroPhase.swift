import Foundation

package enum PomodoroPhase: String, Codable, CaseIterable, Hashable, Sendable {
    case work
    case shortBreak
    case longBreak

    package var title: String {
        switch self {
        case .work:
            "Focus"
        case .shortBreak:
            "Short Break"
        case .longBreak:
            "Long Break"
        }
    }

}
