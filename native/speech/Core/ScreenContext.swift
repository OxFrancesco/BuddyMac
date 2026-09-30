import Foundation

public struct ScreenContext: Sendable {
    public let windowTitle: String?
    public let jpeg: Data

    public init(windowTitle: String?, jpeg: Data) {
        self.windowTitle = windowTitle
        self.jpeg = jpeg
    }
}
