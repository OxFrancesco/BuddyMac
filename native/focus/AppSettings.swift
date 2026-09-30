import Foundation

package struct AppSettings: Codable, Equatable, Sendable {
    package var workDurationMinutes = 25
    package var shortBreakMinutes = 5
    package var longBreakMinutes = 15
    package var longBreakEvery = 4
    package var notificationsEnabled = true
    package var playSoundOnTransitions = true
    package var autoStartNextPhase = false

    package init(
        workDurationMinutes: Int = 25,
        shortBreakMinutes: Int = 5,
        longBreakMinutes: Int = 15,
        longBreakEvery: Int = 4,
        notificationsEnabled: Bool = true,
        playSoundOnTransitions: Bool = true,
        autoStartNextPhase: Bool = false
    ) {
        self.workDurationMinutes = workDurationMinutes
        self.shortBreakMinutes = shortBreakMinutes
        self.longBreakMinutes = longBreakMinutes
        self.longBreakEvery = longBreakEvery
        self.notificationsEnabled = notificationsEnabled
        self.playSoundOnTransitions = playSoundOnTransitions
        self.autoStartNextPhase = autoStartNextPhase
    }

    private enum CodingKeys: String, CodingKey {
        case workDurationMinutes
        case shortBreakMinutes
        case longBreakMinutes
        case longBreakEvery
        case notificationsEnabled
        case playSoundOnTransitions
        case autoStartNextPhase
    }

    package init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        workDurationMinutes = try container.decodeIfPresent(Int.self, forKey: .workDurationMinutes) ?? 25
        shortBreakMinutes = try container.decodeIfPresent(Int.self, forKey: .shortBreakMinutes) ?? 5
        longBreakMinutes = try container.decodeIfPresent(Int.self, forKey: .longBreakMinutes) ?? 15
        longBreakEvery = try container.decodeIfPresent(Int.self, forKey: .longBreakEvery) ?? 4
        notificationsEnabled = try container.decodeIfPresent(Bool.self, forKey: .notificationsEnabled) ?? true
        playSoundOnTransitions = try container.decodeIfPresent(Bool.self, forKey: .playSoundOnTransitions) ?? true
        autoStartNextPhase = try container.decodeIfPresent(Bool.self, forKey: .autoStartNextPhase) ?? false
    }
}
