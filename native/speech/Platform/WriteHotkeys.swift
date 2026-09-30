import Carbon
import Foundation

@MainActor
final class WriteHotkeys {
    private let voiceHotKeyID: UInt32 = 9_999
    private let noteHotKeyBaseID: UInt32 = 20_000

    private var hotKeyRefs: [UInt32: EventHotKeyRef] = [:]
    private var profileIDsByHotKeyID: [UInt32: UUID] = [:]
    private var noteIDsByHotKeyID: [UInt32: UUID] = [:]
    private var eventHandler: EventHandlerRef?
    var onHotKey: ((UUID) -> Void)?
    var onVoiceHotKey: (() -> Void)?
    var onNoteHotKey: ((UUID) -> Void)?

    init() {
        installHandler()
    }

    func register(profiles: [PromptProfile], voiceHotkey: HotkeyDescriptor?, notes: [NoteItem] = []) throws {
        unregisterAll()

        for (index, profile) in profiles.enumerated() {
            guard profile.isEnabled, let hotkey = profile.hotkey, hotkey.isValid else { continue }

            var hotKeyRef: EventHotKeyRef?
            let hotKeyID = EventHotKeyID(signature: fourCharCode("BDGR"), id: UInt32(index + 1))
            let status = RegisterEventHotKey(
                hotkey.keyCode,
                hotkey.carbonModifiers,
                hotKeyID,
                GetEventDispatcherTarget(),
                0,
                &hotKeyRef
            )

            guard status == noErr, let hotKeyRef else {
                unregisterAll()
                throw SpeechFailure(message: "A writing or note shortcut is already used by another app. Disable the original app shortcut before enabling BuddyMac shortcuts.")
            }
            hotKeyRefs[hotKeyID.id] = hotKeyRef
            profileIDsByHotKeyID[hotKeyID.id] = profile.id
        }

        if let voiceHotkey, voiceHotkey.isValid {
            var hotKeyRef: EventHotKeyRef?
            let hotKeyID = EventHotKeyID(signature: fourCharCode("BDVW"), id: voiceHotKeyID)
            let status = RegisterEventHotKey(
                voiceHotkey.keyCode,
                voiceHotkey.carbonModifiers,
                hotKeyID,
                GetEventDispatcherTarget(),
                0,
                &hotKeyRef
            )

            if status == noErr, let hotKeyRef {
                hotKeyRefs[hotKeyID.id] = hotKeyRef
            }
        }

        for (index, note) in notes.enumerated() {
            guard let hotkey = note.hotkey, hotkey.isValid, !note.content.isEmpty else { continue }

            var hotKeyRef: EventHotKeyRef?
            let hotKeyID = EventHotKeyID(signature: fourCharCode("BDNT"), id: noteHotKeyBaseID + UInt32(index))
            let status = RegisterEventHotKey(
                hotkey.keyCode,
                hotkey.carbonModifiers,
                hotKeyID,
                GetEventDispatcherTarget(),
                0,
                &hotKeyRef
            )

            guard status == noErr, let hotKeyRef else {
                unregisterAll()
                throw SpeechFailure(message: "A writing or note shortcut is already used by another app. Disable the original app shortcut before enabling BuddyMac shortcuts.")
            }
            hotKeyRefs[hotKeyID.id] = hotKeyRef
            noteIDsByHotKeyID[hotKeyID.id] = note.id
        }
    }

    func unregisterAll() {
        for ref in hotKeyRefs.values {
            UnregisterEventHotKey(ref)
        }
        hotKeyRefs.removeAll()
        profileIDsByHotKeyID.removeAll()
        noteIDsByHotKeyID.removeAll()
    }

    private func installHandler() {
        var eventSpec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        InstallEventHandler(
            GetEventDispatcherTarget(),
            { _, event, userData in
                guard let event, let userData else { return noErr }
                let service = Unmanaged<WriteHotkeys>.fromOpaque(userData).takeUnretainedValue()
                return MainActor.assumeIsolated { service.handleHotKey(event) }
            },
            1,
            &eventSpec,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandler
        )
    }

    private func handleHotKey(_ event: EventRef) -> OSStatus {
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
            event,
            EventParamName(kEventParamDirectObject),
            EventParamType(typeEventHotKeyID),
            nil,
            MemoryLayout<EventHotKeyID>.size,
            nil,
            &hotKeyID
        )

        guard status == noErr else {
            return status
        }

        guard [fourCharCode("BDGR"), fourCharCode("BDVW"), fourCharCode("BDNT")].contains(hotKeyID.signature) else { return OSStatus(eventNotHandledErr) }

        if hotKeyID.id == voiceHotKeyID {
            onVoiceHotKey?()
            return status
        }

        if let noteID = noteIDsByHotKeyID[hotKeyID.id] {
            onNoteHotKey?(noteID)
            return status
        }

        guard let profileID = profileIDsByHotKeyID[hotKeyID.id] else {
            return status
        }

        onHotKey?(profileID)
        return noErr
    }

    private func fourCharCode(_ string: String) -> OSType {
        string.utf8.reduce(0) { ($0 << 8) + OSType($1) }
    }
}
