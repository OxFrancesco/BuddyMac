import AppKit
import Carbon

struct ShortcutModifiers: OptionSet, Codable, Hashable, Sendable {
    let rawValue: UInt32
    static let control = Self(rawValue: UInt32(controlKey))
    static let option = Self(rawValue: UInt32(optionKey))
    static let shift = Self(rawValue: UInt32(shiftKey))
    static let command = Self(rawValue: UInt32(cmdKey))
    static let supported: Self = [.control, .option, .shift, .command]

    init(rawValue: UInt32) { self.rawValue = rawValue }

    init(_ flags: NSEvent.ModifierFlags) {
        var result: Self = []
        if flags.contains(.control) { result.insert(.control) }
        if flags.contains(.option) { result.insert(.option) }
        if flags.contains(.shift) { result.insert(.shift) }
        if flags.contains(.command) { result.insert(.command) }
        self = result
    }

    var symbols: String {
        [(Self.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘")]
            .filter { contains($0.0) }.map(\.1).joined()
    }

    var names: [String] {
        [(Self.control, "Control"), (.option, "Option"), (.shift, "Shift"), (.command, "Command")]
            .filter { contains($0.0) }.map(\.1)
    }
}

struct DictationShortcut: Codable, Hashable, Sendable {
    var keyCode: UInt16
    var modifiers: ShortcutModifiers
    var keyLabel: String

    var displayName: String { modifiers.symbols + (modifiers.isEmpty ? "" : " ") + keyLabel }
    var spokenName: String { (modifiers.names + [keyLabel]).joined(separator: " + ") }
    var isPlainEscape: Bool { keyCode == UInt16(kVK_Escape) && modifiers.isEmpty }

    /// A single modifier key used on its own, such as Fn or Right Option.
    /// These bypass Carbon hotkeys and are driven by flags-changed monitors.
    var isModifierOnly: Bool { Self.modifierOnlyKeys[keyCode] != nil && modifiers.isEmpty }
    var isFnKey: Bool { keyCode == 63 && modifiers.isEmpty }

    func matchesCancellation(keyCode: UInt16, modifiers: ShortcutModifiers) -> Bool {
        self.keyCode == keyCode && (isPlainEscape || self.modifiers == modifiers)
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.keyCode == rhs.keyCode && lhs.modifiers == rhs.modifiers
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(keyCode)
        hasher.combine(modifiers)
    }

    static func capture(_ event: NSEvent) -> Self? {
        if event.type == .flagsChanged {
            // Only the press counts. The release fires the same key code with the flag cleared.
            guard let label = modifierOnlyKeys[event.keyCode],
                  let flag = modifierFlag(for: event.keyCode),
                  event.modifierFlags.contains(flag) else { return nil }
            return Self(keyCode: event.keyCode, modifiers: [], keyLabel: label)
        }
        guard !event.isARepeat, !modifierKeyCodes.contains(event.keyCode) else { return nil }
        let label = specialKeys[event.keyCode]
            ?? event.charactersIgnoringModifiers?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            ?? ""
        guard !label.isEmpty else { return nil }
        return Self(keyCode: event.keyCode, modifiers: ShortcutModifiers(event.modifierFlags), keyLabel: label)
    }

    static let modifierKeyCodes: Set<UInt16> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]

    /// Modifier keys that work as a shortcut on their own. Left-side keys are
    /// excluded because holding them is part of ordinary typing.
    static let modifierOnlyKeys: [UInt16: String] = [
        63: "Fn", 61: "Right Option", 54: "Right Command", 62: "Right Control", 60: "Right Shift"
    ]

    static func modifierFlag(for keyCode: UInt16) -> NSEvent.ModifierFlags? {
        switch keyCode {
        case 63: .function
        case 58, 61: .option
        case 54, 55: .command
        case 59, 62: .control
        case 56, 60: .shift
        default: nil
        }
    }
    static let functionKeyCodes: Set<UInt16> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90]
    private static let specialKeys: [UInt16: String] = [
        36: "Return", 48: "Tab", 49: "Space", 51: "Delete", 53: "Escape", 76: "Enter", 117: "Forward Delete",
        123: "←", 124: "→", 125: "↓", 126: "↑", 115: "Home", 119: "End", 116: "Page Up", 121: "Page Down",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8",
        101: "F9", 109: "F10", 103: "F11", 111: "F12", 105: "F13", 107: "F14", 113: "F15",
        106: "F16", 64: "F17", 79: "F18", 80: "F19", 90: "F20"
    ]
}

enum ShortcutAction: String, CaseIterable, Identifiable, Sendable {
    case hold, toggle, edit, cancel
    var id: String { rawValue }

    var title: String {
        switch self {
        case .hold: "Hold to dictate"
        case .toggle: "Hands-free dictation"
        case .edit: "Edit selected text"
        case .cancel: "Cancel dictation"
        }
    }

    var detail: String {
        switch self {
        case .hold: "Release the keys to finish."
        case .toggle: "Press once to start, again to finish."
        case .edit: "Select text, then say how to change it."
        case .cancel: "Discard the current recording or request."
        }
    }
}

struct ShortcutBindings: Codable, Equatable, Sendable {
    var hold: DictationShortcut
    var toggle: DictationShortcut
    var edit: DictationShortcut
    var cancel: DictationShortcut

    init(preset: String = "controlOption") {
        let modifiers: ShortcutModifiers = preset == "controlShift" ? [.control, .shift] : [.control, .option]
        hold = DictationShortcut(keyCode: UInt16(kVK_Space), modifiers: modifiers, keyLabel: "Space")
        toggle = DictationShortcut(keyCode: UInt16(kVK_Return), modifiers: modifiers, keyLabel: "Return")
        edit = DictationShortcut(keyCode: UInt16(kVK_ANSI_E), modifiers: modifiers, keyLabel: "E")
        cancel = DictationShortcut(keyCode: UInt16(kVK_Escape), modifiers: [], keyLabel: "Escape")
    }

    subscript(action: ShortcutAction) -> DictationShortcut {
        get {
            switch action {
            case .hold: hold
            case .toggle: toggle
            case .edit: edit
            case .cancel: cancel
            }
        }
        set {
            switch action {
            case .hold: hold = newValue
            case .toggle: toggle = newValue
            case .edit: edit = newValue
            case .cancel: cancel = newValue
            }
        }
    }

    var usesModifierOnlyShortcut: Bool { ShortcutAction.allCases.contains { self[$0].isModifierOnly } }
    var usesFnKey: Bool { ShortcutAction.allCases.contains { self[$0].isFnKey } }

    func validate() throws {
        var assigned: [DictationShortcut: ShortcutAction] = [:]
        for action in ShortcutAction.allCases {
            let shortcut = self[action]
            if DictationShortcut.modifierKeyCodes.contains(shortcut.keyCode) {
                guard DictationShortcut.modifierOnlyKeys[shortcut.keyCode] != nil else {
                    throw ShortcutValidationError(message: "Left-side modifier keys and Caps Lock can't be shortcuts. Use Fn or a right-side modifier key on its own.")
                }
                guard shortcut.modifiers.isEmpty else {
                    throw ShortcutValidationError(message: "\(shortcut.keyLabel) works only on its own, without other modifiers.")
                }
                if let other = assigned[shortcut] {
                    throw ShortcutValidationError(message: "\(shortcut.displayName) is already assigned to \(other.title.lowercased()). Choose a different key.")
                }
                assigned[shortcut] = action
                continue
            }
            guard shortcut.keyCode < 128,
                  !DictationShortcut.modifierKeyCodes.contains(shortcut.keyCode),
                  shortcut.modifiers.subtracting(.supported).isEmpty,
                  !shortcut.keyLabel.isEmpty else {
                throw ShortcutValidationError(message: "Choose a regular key with Control, Option, or Command.")
            }
            let hasModifier = !shortcut.modifiers.intersection([.control, .option, .command]).isEmpty
            let isFunctionKey = DictationShortcut.functionKeyCodes.contains(shortcut.keyCode)
            guard hasModifier || isFunctionKey || (action == .cancel && shortcut.isPlainEscape) else {
                throw ShortcutValidationError(message: "Add Control, Option, or Command to this key. Function keys are also supported. Escape alone is available for cancellation.")
            }
            if let other = assigned[shortcut] {
                throw ShortcutValidationError(message: "\(shortcut.displayName) is already assigned to \(other.title.lowercased()). Choose a different combination.")
            }
            assigned[shortcut] = action
        }
    }
}

/// What macOS does when the Globe (Fn) key is pressed alone. BuddyTalk can't
/// change it, so the UI asks for "Do Nothing" when Fn is a shortcut.
enum GlobeKeyUsage {
    static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension")!

    /// True when System Settings > Keyboard > "Press 🌐 key to" is Do Nothing.
    static var isDoNothing: Bool {
        UserDefaults(suiteName: "com.apple.HIToolbox")?.object(forKey: "AppleFnUsageType") as? Int == 0
    }
}

struct ShortcutValidationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
