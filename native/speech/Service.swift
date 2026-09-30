import AppKit
import AVFoundation
import Foundation

struct Command: Decodable {
    let id: Int
    let method: String
    var text: String?
    var profileId: String?
    var mode: String?
    var insert: Bool?
    var value: String?
    var enabled: Bool?
    var historyId: String?
    var path: String?
    var preferences: Preferences?
    var profile: PromptProfile?
    var note: NoteItem?
    var provider: RewriteProvider?
    var name: String?
    var instruction: String?
}

@MainActor
final class SpeechService {
    private var storage: SpeechStorage
    private let keys = SpeechKeychain()
    private let recorder = AudioRecorder()
    private let insertion = TextInsertion()
    private let hotkey = GlobalHotkey()
    private let writeHotkeys = WriteHotkeys()
    private var target: InsertionTarget?
    private var selectedText: String?
    private var shouldInsert = false
    private var phase = "idle"
    private var operation: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var retryAudio: CapturedAudio?
    private var retryFilename = "dictation.wav"
    private var shortcutsEnabled = false
    private var generation = UUID()
    private var screenTask: Task<ScreenContext?, Never>?
    private var localNormalizer: S1MiniNormalizer?
    private var localNormalizerURL: URL?
    private var modelDownload: Task<Void, Error>?

    init() throws {
        storage = try SpeechStorage()
        recorder.onLevel = { [weak self] level in self?.emit(["event": "level", "level": level]) }
        recorder.onError = { [weak self] error in self?.fail(error) }
        hotkey.onHoldStart = { [weak self] in self?.startFromHotkey(mode: "dictate") }
        hotkey.onHoldEnd = { [weak self] in self?.stopFromHotkey() }
        hotkey.onToggle = { [weak self] in
            guard let self else { return }
            if self.phase == "recording" { self.stopFromHotkey() }
            else { self.startFromHotkey(mode: "dictate") }
        }
        hotkey.onEdit = { [weak self] in
            guard let self else { return }
            if self.phase == "recording" { self.stopFromHotkey() }
            else { self.startFromHotkey(mode: "editSelection") }
        }
        hotkey.onCancel = { [weak self] in try? self?.cancel() }
        hotkey.onError = { [weak self] message in self?.emit(["event": "error", "message": message]) }
        writeHotkeys.onHotKey = { [weak self] id in
            guard let self else { return }
            let command = Command(id: -1, method: "rewriteSelection", profileId: id.uuidString)
            Task { await self.handle(command) }
        }
        writeHotkeys.onNoteHotKey = { [weak self] id in
            guard let self, !self.busy, let note = self.storage.writing.notes.first(where: { $0.id == id }) else { return }
            guard let destination = self.insertion.snapshot() else {
                self.emit(["event": "error", "message": "Focus an external text field before pasting a note."])
                return
            }
            self.generation = UUID()
            let generation = self.generation
            self.setPhase("inserting")
            self.operation = Task { [weak self] in
                guard let self else { return }
                let delivery = await self.deliver(note.content, target: destination, insert: true)
                guard !Task.isCancelled, self.generation == generation else { return }
                self.emit(["event": "result", "source": "note", "text": note.content, "rawText": note.content, "delivery": delivery, "warning": ""])
                self.setPhase("success")
            }
        }
    }

    private var busy: Bool { ["requestingPermission", "recording", "transcribing", "formatting", "inserting"].contains(phase) }

    func receive(_ bytes: Data) {
        do {
            let command = try JSONDecoder().decode(Command.self, from: bytes)
            Task { await handle(command) }
        } catch {
            struct Envelope: Decodable { let id: Int }
            let failure = SpeechFailure(message: "Invalid speech service request.")
            if let envelope = try? JSONDecoder().decode(Envelope.self, from: bytes) {
                reject(envelope.id, failure)
            } else { emit(["event": "error", "message": failure.message]) }
        }
    }

    func shutdown() {
        operation?.cancel()
        deadline?.cancel()
        modelDownload?.cancel()
        screenTask?.cancel()
        recorder.cancel()
        hotkey.stop()
        writeHotkeys.unregisterAll()
    }

    private func handle(_ command: Command) async {
        do {
            switch command.method {
            case "status": reply(command.id, try status())
            case "preferences": reply(command.id, try json(storage.data.preferences))
            case "savePreferences":
                guard !busy, let preferences = command.preferences else { throw SpeechFailure(message: "Finish dictating before changing settings.") }
                try preferences.shortcuts.validate()
                if shortcutsEnabled { try hotkey.apply(preferences.shortcuts) }
                storage.data.preferences = preferences
                if !preferences.saveHistory { storage.data.history.removeAll() }
                try storage.save()
                reply(command.id, try json(preferences))
            case "memory":
                reply(command.id, ["text": try MemoryFile(url: storage.store.url.deletingLastPathComponent().appendingPathComponent("memory.md")).read()])
            case "saveMemory":
                try MemoryFile(url: storage.store.url.deletingLastPathComponent().appendingPathComponent("memory.md")).save(command.text ?? "")
                reply(command.id, ["saved": true])
            case "writing": reply(command.id, try json(storage.writing))
            case "setWriteProvider":
                guard !busy, let provider = command.provider else { throw SpeechFailure(message: "Choose a writing provider while idle.") }
                if case .openRouter(let model) = provider, model.isEmpty || !model.contains("/") { throw SpeechFailure(message: "Enter a valid OpenRouter model ID.") }
                storage.writing.settings.rewriteProvider = provider
                if let local = provider.localModelID { storage.writing.settings.selectedLocalModel = local }
                try saveWriting()
                reply(command.id, try json(storage.writing))
            case "createProfile":
                var profile = PromptProfile.newCustomProfile()
                profile.name = command.name ?? "Custom"
                profile.instruction = command.instruction ?? profile.instruction
                storage.writing.profiles.append(profile)
                try saveWriting()
                reply(command.id, try json(profile))
            case "saveProfile":
                guard var profile = command.profile, let index = storage.writing.profiles.firstIndex(where: { $0.id == profile.id }) else { throw SpeechFailure(message: "Choose an existing writing profile.") }
                if let hotkey = profile.hotkey, !hotkey.isValid { throw SpeechFailure(message: "Choose a valid writing shortcut with a modifier and a regular key.") }
                if let model = profile.openRouterModelID?.trimmingCharacters(in: .whitespacesAndNewlines) {
                    if model.isEmpty { profile.openRouterModelID = nil }
                    else if !model.contains("/") { throw SpeechFailure(message: "Enter a valid OpenRouter model ID.") }
                    else { profile.openRouterModelID = model }
                }
                if profile.id == PromptProfile.grammarProfileID {
                    profile.name = PromptProfile.standard.name
                    profile.instruction = PromptProfile.standard.instruction
                    profile.isBuiltIn = true
                } else { profile.isBuiltIn = false }
                if profile.hotkey == nil { profile.isEnabled = false }
                storage.writing.profiles[index] = profile
                try saveWriting()
                reply(command.id, try json(profile))
            case "moveProfile":
                guard command.value == "up" || command.value == "down" else { throw SpeechFailure(message: "Choose up or down to reorder a profile.") }
                guard let id = command.profileId, let index = storage.writing.profiles.firstIndex(where: { $0.id.uuidString.lowercased() == id.lowercased() }),
                      storage.writing.profiles[index].id != PromptProfile.grammarProfileID else { throw SpeechFailure(message: "The Standard profile stays first.") }
                let next = command.value == "up" ? max(1, index - 1) : min(storage.writing.profiles.count - 1, index + 1)
                if index != next {
                    let profile = storage.writing.profiles.remove(at: index)
                    storage.writing.profiles.insert(profile, at: next)
                    try saveWriting()
                }
                reply(command.id, try json(storage.writing))
            case "deleteProfile":
                guard let id = command.profileId, let uuid = UUID(uuidString: id), uuid != PromptProfile.grammarProfileID else { throw SpeechFailure(message: "The Standard profile cannot be deleted.") }
                storage.writing.profiles.removeAll { $0.id == uuid }
                try saveWriting()
                reply(command.id, ["deleted": true])
            case "createNote":
                let note = NoteItem(title: command.name ?? "New note", content: command.text ?? "")
                storage.writing.notes.insert(note, at: 0)
                try saveWriting()
                reply(command.id, try json(note))
            case "saveNote":
                guard var note = command.note, let index = storage.writing.notes.firstIndex(where: { $0.id == note.id }) else { throw SpeechFailure(message: "Choose an existing note.") }
                if let hotkey = note.hotkey, !hotkey.isValid { throw SpeechFailure(message: "Choose a valid note shortcut with a modifier and a regular key.") }
                note.updatedAt = Date()
                storage.writing.notes[index] = note
                try saveWriting()
                reply(command.id, try json(note))
            case "deleteNote":
                guard let id = command.historyId, let uuid = UUID(uuidString: id) else { throw SpeechFailure(message: "Choose a note.") }
                storage.writing.notes.removeAll { $0.id == uuid }
                try saveWriting()
                reply(command.id, ["deleted": true])
            case "normalizeLocally":
                guard !busy, let text = command.text, !text.isEmpty else { throw SpeechFailure(message: "Enter text while dictation is idle.") }
                let preferences = storage.data.preferences
                guard S1MiniPrompt.supports(language: preferences.language, style: preferences.style) else { throw SpeechFailure(message: "Choose English and a cleanup style before using S1-mini.") }
                let protected = TextProcessor.protect(text, vocabulary: preferences.vocabulary, snippets: preferences.snippets)
                generation = UUID()
                let id = generation
                let modelURL = storage.modelURL
                setPhase("formatting")
                operation = Task { [weak self] in
                    guard let self else { return }
                    do {
                        let normalizer = S1MiniNormalizer(modelURL: modelURL)
                        let result = try await normalizer.normalize(protected.text, style: preferences.style)
                        try Task.checkCancellation()
                        guard generation == id else { throw CancellationError() }
                        reply(command.id, ["text": try protected.restore(result)])
                        setPhase("success")
                    } catch {
                        if generation == id { fail(error) }
                        reject(command.id, error)
                    }
                }
            case "downloadLocalCleanup":
                guard modelDownload == nil else { throw SpeechFailure(message: "The model download is already running.") }
                let url = storage.store.url.deletingLastPathComponent().appendingPathComponent("models").appendingPathComponent(S1MiniModel.filename)
                let task = Task { try await S1MiniModel.download(to: url, progress: { _ in }) }
                modelDownload = task
                defer { modelDownload = nil }
                try await task.value
                reply(command.id, ["downloaded": true])
            case "cancelLocalDownload":
                modelDownload?.cancel()
                reply(command.id, ["cancelled": true])
            case "requestScreenCapture":
                ScreenContextCapture.requestAccess()
                reply(command.id, ["granted": ScreenContextCapture.isAllowed])
            case "start":
                try await start(mode: command.mode ?? "dictate", insert: command.insert ?? false)
                reply(command.id, ["phase": phase])
            case "stop":
                try stop()
                reply(command.id, ["phase": phase])
            case "cancel":
                try cancel()
                reply(command.id, ["phase": phase])
            case "retry":
                guard !busy, let audio = retryAudio else { throw SpeechFailure(message: "There is no failed recording to retry.") }
                target = nil
                shouldInsert = false
                process(audio, filename: retryFilename)
                reply(command.id, ["phase": phase])
            case "importAudio":
                guard !busy, let path = command.path else { throw SpeechFailure(message: "Choose an audio file while dictation is idle.") }
                let url = URL(fileURLWithPath: path)
                let ext = url.pathExtension.lowercased()
                guard ["wav", "mp3", "flac"].contains(ext) else { throw SpeechFailure(message: "Choose WAV, MP3, or FLAC audio.") }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 24 * 1024 * 1024 else { throw SpeechFailure(message: "Choose audio smaller than 24 MB.") }
                let file = try AVAudioFile(forReading: url)
                let audio = CapturedAudio(data: try Data(contentsOf: url), duration: Double(file.length) / file.processingFormat.sampleRate, fileURL: url)
                target = nil
                selectedText = nil
                shouldInsert = false
                retryAudio = audio
                retryFilename = url.lastPathComponent
                process(audio, filename: retryFilename)
                reply(command.id, ["phase": phase])
            case "rewrite", "rewriteSelection":
                guard !busy else { throw SpeechFailure(message: "Finish the current speech operation first.") }
                let destination = command.method == "rewriteSelection" ? insertion.snapshot() : nil
                let source = destination?.selectedText ?? command.text ?? ""
                guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, destination?.isSecure != true else {
                    throw SpeechFailure(message: "Select text in another app, or enter text to rewrite.")
                }
                let profile = try profile(command.profileId)
                guard storage.writeProvider == "openRouter" else { throw SpeechFailure(message: "Your imported Write provider uses a local MLX model. That engine is not available in BuddyMac yet.") }
                let id = UUID()
                generation = id
                setPhase("formatting")
                operation = Task { [weak self] in
                    guard let self else { return }
                    do {
                        let client = OpenRouterClient(apiKey: try keys.read())
                        let result = try await client.rewrite(source, instruction: profile.instruction,
                                                              model: profile.openRouterModelID ?? storage.writeModel)
                        try Task.checkCancellation()
                        guard generation == id else { return }
                        let delivery: String
                        if destination != nil && storage.writing.settings.outputMode == .copyToClipboard {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(result, forType: .string)
                            delivery = "copied"
                        } else { delivery = await deliver(result, target: destination, insert: destination != nil) }
                        guard generation == id else { return }
                        emit(["event": "result", "source": "write", "text": result, "rawText": source, "delivery": delivery, "warning": ""])
                        setPhase("success")
                        reply(command.id, ["text": result, "delivery": delivery])
                    } catch {
                        if generation == id { fail(error) }
                        reject(command.id, error)
                    }
                }
            case "captureSelection":
                guard let destination = insertion.snapshot(), !destination.isSecure,
                      let text = destination.selectedText, !text.isEmpty else { throw SpeechFailure(message: "No external text selection is available.") }
                reply(command.id, ["text": text, "appName": destination.appName])
            case "setKey":
                try keys.save(command.value ?? "")
                reply(command.id, ["configured": true])
            case "removeKey":
                try keys.remove()
                reply(command.id, ["configured": false])
            case "setOutputMode":
                guard !busy, let value = command.value, let mode = OutputMode(rawValue: value) else { throw SpeechFailure(message: "Choose replace selection or copy to clipboard.") }
                storage.writing.settings.outputMode = mode
                try saveWriting()
                reply(command.id, try json(storage.writing))
            case "removeLocalModel":
                guard !busy, modelDownload == nil else { throw SpeechFailure(message: "Wait for the current operation to finish.") }
                let own = storage.store.url.deletingLastPathComponent().appendingPathComponent("models").appendingPathComponent(S1MiniModel.filename)
                localNormalizer = nil
                localNormalizerURL = nil
                if FileManager.default.fileExists(atPath: own.path) { try FileManager.default.removeItem(at: own) }
                reply(command.id, ["removed": true])
            case "history":
                reply(command.id, try json(storage.data.history))
            case "deleteHistory":
                guard let id = command.historyId, let uuid = UUID(uuidString: id) else { throw SpeechFailure(message: "Choose a history entry.") }
                storage.data.history.removeAll { $0.id == uuid }
                try storage.save()
                reply(command.id, ["deleted": true])
            case "clearHistory":
                storage.data.history.removeAll()
                try storage.save()
                reply(command.id, ["deleted": true])
            case "enableShortcuts":
                guard !busy else { throw SpeechFailure(message: "Finish dictating before changing shortcuts.") }
                if command.enabled == true {
                    do {
                        try validateCombinedShortcuts()
                        try hotkey.apply(storage.data.preferences.shortcuts)
                        try writeHotkeys.register(profiles: storage.profiles, voiceHotkey: nil, notes: storage.writing.notes)
                        shortcutsEnabled = true
                    } catch {
                        hotkey.stop()
                        writeHotkeys.unregisterAll()
                        shortcutsEnabled = false
                        throw error
                    }
                } else {
                    hotkey.stop()
                    writeHotkeys.unregisterAll()
                    shortcutsEnabled = false
                }
                reply(command.id, ["enabled": shortcutsEnabled])
            case "requestAccessibility":
                reply(command.id, ["granted": AccessibilityAccess.request()])
            default: throw SpeechFailure(message: "Unsupported speech service operation.")
            }
        } catch { reject(command.id, error) }
    }

    private func validateCombinedShortcuts() throws {
        try storage.data.preferences.shortcuts.validate()
        var used = Set<String>()
        for action in ShortcutAction.allCases {
            let shortcut = storage.data.preferences.shortcuts[action]
            used.insert("\(shortcut.keyCode):\(shortcut.modifiers.rawValue)")
        }
        let writing = storage.profiles.filter(\.isEnabled).compactMap(\.hotkey)
            + storage.writing.notes.filter { !$0.content.isEmpty }.compactMap(\.hotkey)
        for shortcut in writing {
            guard shortcut.isValid else { throw SpeechFailure(message: "Choose a valid writing or note shortcut before enabling shortcuts.") }
            guard used.insert("\(shortcut.keyCode):\(shortcut.carbonModifiers)").inserted else {
                throw SpeechFailure(message: "Two Talk, writing-profile, or note actions share a shortcut. Give each action a different shortcut before enabling them.")
            }
        }
    }

    private func saveWriting() throws {
        try storage.saveWriting()
        if shortcutsEnabled {
            do {
                try validateCombinedShortcuts()
                try writeHotkeys.register(profiles: storage.profiles, voiceHotkey: nil, notes: storage.writing.notes)
            } catch {
                hotkey.stop()
                writeHotkeys.unregisterAll()
                shortcutsEnabled = false
                emit(["event": "error", "message": "Settings saved, but shortcuts were disabled. " + error.localizedDescription])
            }
        }
    }

    private func profile(_ id: String?) throws -> PromptProfile {
        if let id {
            guard let match = storage.profiles.first(where: { $0.id.uuidString.lowercased() == id.lowercased() }) else {
                throw SpeechFailure(message: "The selected writing profile is unavailable.")
            }
            return match
        }
        return storage.profiles.first ?? .standard
    }

    private func status() throws -> [String: Any] {
        ["phase": phase, "microphoneGranted": recorder.permission == .authorized,
         "accessibilityGranted": insertion.accessibilityGranted, "keyConfigured": keys.configured(),
         "shortcutsEnabled": shortcutsEnabled, "profiles": try json(storage.profiles),
         "writeModel": storage.writeModel, "writeProvider": storage.writeProvider,
         "historyCount": storage.data.history.count, "canRetry": retryAudio != nil && !busy,
         "shortcuts": try json(storage.data.preferences.shortcuts),
         "screenCaptureGranted": ScreenContextCapture.isAllowed,
         "localModelPath": storage.modelURL.path,
         "localModelPresent": FileManager.default.fileExists(atPath: storage.modelURL.path),
         "limitations": ["Local MLX rewriting is not yet bundled.",
                          "Apple, ElevenLabs and Whisper transcription are not yet bundled.",
                          "BuddyWrite's separate voice shortcut/provider is preserved but not activated."]]
    }

    private func start(mode: String, insert: Bool) async throws {
        guard !busy else { throw SpeechFailure(message: "A speech operation is already running.") }
        guard ["dictate", "editSelection"].contains(mode) else { throw SpeechFailure(message: "Unknown recording mode.") }
        guard keys.configured() else { throw SpeechFailure(message: "Add an OpenRouter key before recording.") }
        let destination = insertion.snapshot()
        let selection = mode == "editSelection" ? destination?.selectedText : nil
        if mode == "editSelection", selection?.isEmpty != false || destination?.isSecure == true {
            throw SpeechFailure(message: "Select text in another app before recording an edit.")
        }
        target = destination
        screenTask?.cancel()
        screenTask = nil
        if storage.data.preferences.screenContextEnabled, let destination, !destination.isSecure {
            screenTask = Task { try? await ScreenContextCapture.capture(processID: destination.processID) }
        }
        selectedText = selection
        shouldInsert = insert
        retryAudio = nil
        generation = UUID()
        let id = generation
        setPhase("requestingPermission")
        do {
            try await recorder.start()
            guard generation == id else { return }
            setPhase("recording")
            if storage.data.preferences.playSounds { NSSound(named: "Tink")?.play() }
            if shortcutsEnabled { hotkey.setCancellationEnabled(true) }
            deadline = Task { [weak self] in
                try? await Task.sleep(for: .seconds(300))
                guard !Task.isCancelled else { return }
                self?.stopFromHotkey()
            }
        } catch {
            if generation == id { fail(error) }
            throw error
        }
    }

    private func stop() throws {
        guard phase == "recording" else { throw SpeechFailure(message: "There is no active recording.") }
        deadline?.cancel()
        do {
            let audio = try recorder.stop()
            retryAudio = audio
            retryFilename = "dictation.wav"
            process(audio, filename: retryFilename)
        } catch { fail(error); throw error }
    }

    private func cancel() throws {
        guard phase != "inserting" else { throw SpeechFailure(message: "Insertion is already being delivered.") }
        generation = UUID()
        operation?.cancel()
        deadline?.cancel()
        recorder.cancel()
        screenTask?.cancel()
        screenTask = nil
        if shortcutsEnabled { hotkey.setCancellationEnabled(false) }
        setPhase("idle")
    }

    private func process(_ audio: CapturedAudio, filename: String) {
        generation = UUID()
        let id = generation
        let preferences = storage.data.preferences
        let destination = target
        let selection = selectedText
        let insert = shouldInsert
        setPhase("transcribing")
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let client = OpenRouterClient(apiKey: try keys.read())
                let style = preferences.style(for: destination?.bundleIdentifier)
                let response = try await client.transcribeWithFallback(TranscriptionRequest(
                    audio: audio.data, fileName: filename,
                    mimeType: filename.lowercased().hasSuffix("mp3") ? "audio/mpeg" : filename.lowercased().hasSuffix("flac") ? "audio/flac" : "audio/wav",
                    language: preferences.language == "auto" ? nil : preferences.language,
                    vocabulary: preferences.vocabulary, verbatim: style == .verbatim))
                try Task.checkCancellation()
                guard generation == id else { return }
                var output = response.text
                var warnings: [String] = []
                var memory: String?
                if preferences.memoryEnabled {
                    do { memory = try MemoryFile(url: storage.store.url.deletingLastPathComponent().appendingPathComponent("memory.md")).read() }
                    catch { warnings.append("Memory could not be read.") }
                }
                let screen = await screenTask?.value
                if preferences.screenContextEnabled && screen == nil { warnings.append("Screen context was unavailable.") }
                try Task.checkCancellation()
                if let selection {
                    setPhase("formatting")
                    output = try await client.edit(selection, instruction: output, model: preferences.cleanupModel, memory: memory, screen: screen)
                } else if preferences.cleanupEnabled && style != .verbatim {
                    setPhase("formatting")
                    let protected = TextProcessor.protect(output, vocabulary: preferences.vocabulary, snippets: preferences.snippets)
                    do {
                        let cleaned: String
                        if preferences.localCleanupEnabled {
                            guard S1MiniPrompt.supports(language: preferences.language, style: style) else {
                                throw SpeechFailure(message: "Local S1-mini cleanup needs an English language setting. Choose English or select cloud cleanup.")
                            }
                            let url = storage.modelURL
                            if localNormalizerURL != url {
                                localNormalizer = S1MiniNormalizer(modelURL: url)
                                localNormalizerURL = url
                            }
                            guard let localNormalizer else { throw SpeechFailure(message: "The local cleanup engine could not start.") }
                            cleaned = try await localNormalizer.normalize(protected.text, style: style)
                        } else {
                            cleaned = try await client.cleanUp(protected.text, settings: CleanupSettings(enabled: true, style: style, model: preferences.cleanupModel),
                                                               context: destination?.appName, vocabulary: preferences.vocabulary, memory: memory, screen: screen)
                        }
                        output = try protected.restore(cleaned)
                    } catch is CancellationError { throw CancellationError() }
                    catch {
                        output = TextProcessor.process(response.text, vocabulary: preferences.vocabulary, snippets: preferences.snippets)
                        warnings.append("Cleanup failed. Original wording kept. " + error.localizedDescription)
                    }
                } else { output = TextProcessor.process(output, vocabulary: preferences.vocabulary, snippets: preferences.snippets) }
                try Task.checkCancellation()
                guard generation == id else { return }
                if preferences.saveHistory {
                    storage.data.history.insert(HistoryEntry(rawText: response.text, text: output, appName: destination?.appName ?? "BuddyMac", duration: audio.duration), at: 0)
                    storage.data.history = Array(storage.data.history.prefix(200))
                    do { try storage.save() } catch { warnings.append("History could not be saved.") }
                }
                let delivery = await deliver(output, target: destination, insert: insert && preferences.autoPaste)
                guard generation == id else { return }
                retryAudio = nil
                screenTask = nil
                if shortcutsEnabled { hotkey.setCancellationEnabled(false) }
                emit(["event": "result", "source": "talk", "text": output, "rawText": response.text, "delivery": delivery, "warning": warnings.joined(separator: " ")])
                setPhase("success")
                if preferences.playSounds { NSSound(named: "Pop")?.play() }
            } catch {
                guard generation == id else { return }
                fail(error)
            }
        }
    }

    private func deliver(_ text: String, target: InsertionTarget?, insert: Bool) async -> String {
        guard insert, let target else { return "ready" }
        setPhase("inserting")
        switch await insertion.insert(text, into: target, restoreClipboard: storage.data.preferences.restoreClipboard) {
        case .inserted: return "inserted"
        case .copied(let reason, _): return reason
        case .cancelled: return "cancelled"
        }
    }

    private func startFromHotkey(mode: String) {
        guard !busy else { return }
        Task { do { try await start(mode: mode, insert: true) } catch is CancellationError {} catch { fail(error) } }
    }
    private func stopFromHotkey() {
        if phase == "requestingPermission" { try? cancel() }
        else if phase == "recording" { do { try stop() } catch { fail(error) } }
    }

    private func fail(_ error: Error) {
        if error is CancellationError { setPhase("idle"); return }
        deadline?.cancel()
        recorder.cancel()
        if shortcutsEnabled { hotkey.setCancellationEnabled(false) }
        setPhase("failed")
        emit(["event": "error", "message": error.localizedDescription,
              "recordingPath": retryAudio?.fileURL?.path ?? recorder.lastRecordingURL?.path ?? ""])
    }
    private func setPhase(_ value: String) { phase = value; emit(["event": "phase", "phase": value]) }
    private func reply(_ id: Int, _ value: Any) { if id >= 0 { emit(["id": id, "ok": true, "result": value]) } }
    private func reject(_ id: Int, _ error: Error) {
        if id >= 0 { emit(["id": id, "ok": false, "error": error.localizedDescription]) }
        else { emit(["event": "error", "message": error.localizedDescription]) }
    }
    private func json<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
    private func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        // BuddyMac may already be gone. A throwing write fails quietly instead of raising an Objective-C exception.
        try? FileHandle.standardOutput.write(contentsOf: data + Data([10]))
    }
}
