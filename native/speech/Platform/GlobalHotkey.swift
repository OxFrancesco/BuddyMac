import AppKit
import Carbon

@MainActor
final class GlobalHotkey {
    var onHoldStart: (() -> Void)?
    var onHoldEnd: (() -> Void)?
    var onToggle: (() -> Void)?
    var onEdit: (() -> Void)?
    var onCancel: (() -> Void)?
    var onError: ((String) -> Void)?
    var captureHandler: ((DictationShortcut) -> Void)?

    private struct Registration {
        let reference: EventHotKeyRef
        let id: UInt32
    }

    private var handler: EventHandlerRef?
    private var registered: [DictationShortcut: Registration] = [:]
    private var bindings: ShortcutBindings?
    private var nextID: UInt32 = 1
    private var holdIsDown = false
    private var pressedIDs: Set<UInt32> = []
    private var cancellationEnabled = false
    private var localCancelMonitor: Any?
    private var globalCancelMonitor: Any?
    private var localModifierMonitor: Any?
    private var globalModifierMonitor: Any?
    private var pressedModifierCodes: Set<UInt16> = []
    private static let signature: OSType = 0x42544C4B

    func apply(_ candidate: ShortcutBindings) throws {
        try candidate.validate()
        try installHandler()
        var staged: [DictationShortcut: Registration] = [:]
        do {
            for action in ShortcutAction.allCases {
                let shortcut = candidate[action]
                if shortcut.isPlainEscape || shortcut.isModifierOnly || registered[shortcut] != nil || staged[shortcut] != nil { continue }
                staged[shortcut] = try register(shortcut, action: action)
            }
        } catch {
            for registration in staged.values { UnregisterEventHotKey(registration.reference) }
            throw ShortcutValidationError(message: "\(error.localizedDescription) Your previous shortcuts are unchanged.")
        }
        var retained = Set([candidate.hold, candidate.toggle, candidate.edit])
        if cancellationEnabled && !candidate.cancel.isPlainEscape { retained.insert(candidate.cancel) }
        let available = registered.merging(staged) { old, _ in old }
        for (shortcut, registration) in available where !retained.contains(shortcut) {
            UnregisterEventHotKey(registration.reference)
        }
        registered = available.filter { retained.contains($0.key) }
        bindings = candidate
        holdIsDown = false
        pressedIDs.removeAll()
        refreshCancelMonitors()
        refreshModifierMonitors()
        if candidate.usesModifierOnlyShortcut && !AccessibilityAccess.isGranted {
            onError?("Fn and modifier-key shortcuts need Accessibility access to work in other apps. Allow it under Settings > Privacy.")
        }
    }

    func stop() {
        cancellationEnabled = false
        removeCancelMonitors()
        removeModifierMonitors()
        for registration in registered.values { UnregisterEventHotKey(registration.reference) }
        registered.removeAll()
        if let handler { RemoveEventHandler(handler) }
        handler = nil
        bindings = nil
        holdIsDown = false
        pressedIDs.removeAll()
        captureHandler = nil
    }

    func setCancellationEnabled(_ enabled: Bool) {
        guard cancellationEnabled != enabled else { return }
        cancellationEnabled = enabled
        guard let shortcut = bindings?.cancel else { return }
        if !shortcut.isPlainEscape {
            if enabled {
                do { registered[shortcut] = try register(shortcut, action: .cancel) }
                catch { onError?("\(error.localizedDescription) Use the on-screen Cancel button for this dictation.") }
            } else if let registration = registered.removeValue(forKey: shortcut) {
                UnregisterEventHotKey(registration.reference)
                pressedIDs.remove(registration.id)
            }
        }
        refreshCancelMonitors()
        refreshModifierMonitors()
    }

    private func installHandler() throws {
        guard handler == nil else { return }
        var eventTypes = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))
        ]
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var hotkeyID = EventHotKeyID()
            let result = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                nil, MemoryLayout<EventHotKeyID>.size, nil, &hotkeyID)
            guard result == noErr, hotkeyID.signature == 0x42544C4B else { return OSStatus(eventNotHandledErr) }
            let service = Unmanaged<GlobalHotkey>.fromOpaque(context).takeUnretainedValue()
            let id = hotkeyID.id
            let isDown = GetEventKind(event) == UInt32(kEventHotKeyPressed)
            MainActor.assumeIsolated { service.handle(id: id, isDown: isDown) }
            return noErr
        }, eventTypes.count, &eventTypes, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else {
            throw ShortcutValidationError(message: "macOS couldn't start keyboard shortcuts. Error \(status).")
        }
    }

    private func register(_ shortcut: DictationShortcut, action: ShortcutAction) throws -> Registration {
        var reference: EventHotKeyRef?
        let id = nextID
        nextID &+= 1
        let status = RegisterEventHotKey(UInt32(shortcut.keyCode), shortcut.modifiers.rawValue,
            EventHotKeyID(signature: Self.signature, id: id), GetApplicationEventTarget(), 0, &reference)
        guard status == noErr, let reference else {
            throw ShortcutValidationError(message: "\(shortcut.displayName) couldn't be registered for \(action.title.lowercased()). Another app or macOS may be using it.")
        }
        return Registration(reference: reference, id: id)
    }

    private func handle(id: UInt32, isDown: Bool) {
        guard let shortcut = registered.first(where: { $0.value.id == id })?.key else { return }
        if isDown {
            guard pressedIDs.insert(id).inserted else { return }
            if let captureHandler { captureHandler(shortcut); return }
            dispatch(shortcut, isDown: true)
        } else {
            pressedIDs.remove(id)
            dispatch(shortcut, isDown: false)
        }
    }

    private func dispatch(_ shortcut: DictationShortcut, isDown: Bool) {
        guard let bindings else { return }
        if isDown {
            if shortcut == bindings.hold { holdIsDown = true; onHoldStart?() }
            else if shortcut == bindings.toggle { onToggle?() }
            else if shortcut == bindings.edit { onEdit?() }
            else if shortcut == bindings.cancel && cancellationEnabled { onCancel?() }
        } else if shortcut == bindings.hold && holdIsDown {
            holdIsDown = false
            onHoldEnd?()
        }
    }

    // MARK: Modifier-only shortcuts (Fn, right-side modifiers)

    private func refreshModifierMonitors() {
        removeModifierMonitors()
        guard let bindings, bindings.usesModifierOnlyShortcut else { return }
        localModifierMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            MainActor.assumeIsolated { self?.handleModifier(event) }
            return event
        }
        globalModifierMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            MainActor.assumeIsolated { self?.handleModifier(event) }
        }
    }

    private func handleModifier(_ event: NSEvent) {
        // The recorder sheet reads these events itself while capturing.
        guard captureHandler == nil, let bindings,
              let flag = DictationShortcut.modifierFlag(for: event.keyCode),
              let label = DictationShortcut.modifierOnlyKeys[event.keyCode] else { return }
        let shortcut = DictationShortcut(keyCode: event.keyCode, modifiers: [], keyLabel: label)
        guard [bindings.hold, bindings.toggle, bindings.edit, bindings.cancel].contains(shortcut) else { return }
        // A press sets the flag. The release repeats the key code, possibly with
        // the flag still set if the paired left key is held, so track by key code.
        if event.modifierFlags.contains(flag), !pressedModifierCodes.contains(event.keyCode) {
            pressedModifierCodes.insert(event.keyCode)
            dispatch(shortcut, isDown: true)
        } else if pressedModifierCodes.contains(event.keyCode) {
            pressedModifierCodes.remove(event.keyCode)
            dispatch(shortcut, isDown: false)
        }
    }

    private func removeModifierMonitors() {
        if let localModifierMonitor { NSEvent.removeMonitor(localModifierMonitor) }
        if let globalModifierMonitor { NSEvent.removeMonitor(globalModifierMonitor) }
        localModifierMonitor = nil
        globalModifierMonitor = nil
        pressedModifierCodes.removeAll()
    }

    private func refreshCancelMonitors() {
        removeCancelMonitors()
        guard cancellationEnabled, let shortcut = bindings?.cancel, shortcut.isPlainEscape else { return }
        localCancelMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard shortcut.matchesCancellation(keyCode: event.keyCode, modifiers: ShortcutModifiers(event.modifierFlags)) else { return event }
            MainActor.assumeIsolated { self?.onCancel?() }
            return nil
        }
        globalCancelMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard shortcut.matchesCancellation(keyCode: event.keyCode, modifiers: ShortcutModifiers(event.modifierFlags)) else { return }
            MainActor.assumeIsolated { self?.onCancel?() }
        }
    }

    private func removeCancelMonitors() {
        if let localCancelMonitor { NSEvent.removeMonitor(localCancelMonitor) }
        if let globalCancelMonitor { NSEvent.removeMonitor(globalCancelMonitor) }
        localCancelMonitor = nil
        globalCancelMonitor = nil
    }
}
