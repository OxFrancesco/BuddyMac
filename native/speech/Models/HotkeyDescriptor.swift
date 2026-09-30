import AppKit
import Carbon
import Foundation

struct HotkeyDescriptor: Codable, Hashable, Sendable {
    var keyCode: UInt32
    var modifiersRawValue: UInt

    init(keyCode: UInt32, modifiers: NSEvent.ModifierFlags) {
        self.keyCode = keyCode
        self.modifiersRawValue = modifiers.intersection([.command, .option, .control, .shift]).rawValue
    }

    var modifiers: NSEvent.ModifierFlags {
        NSEvent.ModifierFlags(rawValue: modifiersRawValue)
            .intersection([.command, .option, .control, .shift])
    }

    var carbonModifiers: UInt32 {
        var result: UInt32 = 0
        if modifiers.contains(.command) { result |= UInt32(cmdKey) }
        if modifiers.contains(.option) { result |= UInt32(optionKey) }
        if modifiers.contains(.control) { result |= UInt32(controlKey) }
        if modifiers.contains(.shift) { result |= UInt32(shiftKey) }
        return result
    }

    var displayString: String {
        let pieces = modifierGlyphs + [KeyCodeMap.displayName(for: keyCode)]
        return pieces.joined()
    }

    var isValid: Bool {
        keyCode < 128 && !DictationShortcut.modifierKeyCodes.contains(UInt16(keyCode))
            && !modifiers.isEmpty && modifiers.rawValue == modifiersRawValue
    }

    private var modifierGlyphs: [String] {
        var values: [String] = []
        if modifiers.contains(.control) { values.append("^") }
        if modifiers.contains(.option) { values.append("⌥") }
        if modifiers.contains(.shift) { values.append("⇧") }
        if modifiers.contains(.command) { values.append("⌘") }
        return values
    }
}

enum KeyCodeMap {
    private static let names: [UInt32: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X",
        8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
        16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
        23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
        30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 37: "L",
        38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",", 44: "/",
        45: "N", 46: "M", 47: ".", 49: "Space", 36: "Return", 48: "Tab",
        51: "Delete", 53: "Esc", 122: "F1", 120: "F2", 99: "F3", 118: "F4",
        96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10",
        103: "F11", 111: "F12", 123: "←", 124: "→", 125: "↓", 126: "↑"
    ]

    static func displayName(for keyCode: UInt32) -> String {
        names[keyCode, default: "Key \(keyCode)"]
    }
}
