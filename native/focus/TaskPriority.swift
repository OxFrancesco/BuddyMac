import Foundation

package enum TaskPriority: String, Codable, CaseIterable, Identifiable, Hashable, Sendable {
    case p1
    case p2
    case p3
    case p4

    package var id: String { rawValue }

    package var title: String {
        switch self {
        case .p1:
            "P1"
        case .p2:
            "P2"
        case .p3:
            "P3"
        case .p4:
            "P4"
        }
    }

    package var description: String {
        switch self {
        case .p1:
            "Urgent"
        case .p2:
            "High"
        case .p3:
            "Normal"
        case .p4:
            "Low"
        }
    }

    package var rank: Int {
        switch self {
        case .p1:
            1
        case .p2:
            2
        case .p3:
            3
        case .p4:
            4
        }
    }
}
