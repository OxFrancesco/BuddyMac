import Foundation

package enum DailyMood: Int, Codable, CaseIterable, Hashable, Sendable {
    case verySad = 1
    case sad = 2
    case neutral = 3
    case happy = 4
    case veryHappy = 5

    package var symbol: String {
        switch self {
        case .verySad: ":("
        case .sad: ":-("
        case .neutral: ":|"
        case .happy: ":)"
        case .veryHappy: ":D"
        }
    }

    package var title: String {
        switch self {
        case .verySad: "Rough"
        case .sad: "Low"
        case .neutral: "Okay"
        case .happy: "Good"
        case .veryHappy: "Great"
        }
    }
}

package struct DailyCheckIn: Codable, Identifiable, Hashable, Sendable {
    package let id: UUID
    package var day: Date
    package var mood: DailyMood
    package var text: String
    package let createdAt: Date
    package var updatedAt: Date

    package init(
        id: UUID = UUID(),
        day: Date,
        mood: DailyMood = .neutral,
        text: String = "",
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.day = day
        self.mood = mood
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
