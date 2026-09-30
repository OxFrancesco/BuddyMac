import CoreData
import Darwin
import Foundation

private struct InputError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct TaskDraft: Decodable {
    var id: UUID?
    var title: String
    var notes: String = ""
    var projectName: String = ""
    var tags: [String] = []
    var priority: TaskPriority = .p3
    var dueDate: Date?
}
private struct TaskSelection: Decodable { let id: UUID? }
private struct TaskOrder: Decodable { let ids: [UUID] }
private struct Completion: Decodable { let id: UUID; let isCompleted: Bool }
private struct CheckInDraft: Decodable { let day: Date; let mood: DailyMood; let text: String }
private struct ImportRequest: Decodable { let source: String? }

@main
private enum FocusMain {
    static func main() async {
        if CommandLine.arguments.dropFirst().first == "serve" { await serve(); return }
        do {
            try deliverAlertIfRequested()
            let snapshot = try run()
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(snapshot)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            FileHandle.standardError.write(Data("BuddyMac Focus: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    private static func deliverAlertIfRequested() throws {
        let command = CommandLine.arguments.dropFirst().first
        guard command == "notify" || command == "notification-permission" else { return }
        if ProcessInfo.processInfo.environment["BUDDYMAC_FOCUS_DISABLE_ALERTS"] == "1" { return }
        throw InputError(message: "Notification operations run inside BuddyMac. Use Focus settings in the running app.")
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: data)
    }

    private struct Location {
        let directory: URL
        let store: URL
        let shared: Bool
    }

    /// BuddyMac keeps its own store until the NotchFlow migration writes location.json. After that it shares
    /// NotchFlow's store, so the NotchFlow CLI, the phone app and iCloud all see the same data.
    private static func location() throws -> Location {
        let fm = FileManager.default
        let environment = ProcessInfo.processInfo.environment
        let isolated = environment["BUDDYMAC_FOCUS_HOME"].map { URL(fileURLWithPath: $0) }
        let directory = isolated ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/BuddyMac/Focus")
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        umask(0o077)
        if isolated == nil,
           let data = try? Data(contentsOf: directory.appendingPathComponent("location.json")),
           let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["store"] as? String == "notchflow" {
            return Location(directory: directory, store: try StoreLocation.defaultURL(), shared: true)
        }
        return Location(directory: directory, store: directory.appendingPathComponent("Focus.store"), shared: false)
    }

    private static func testNow() -> Date {
        ProcessInfo.processInfo.environment["BUDDYMAC_FOCUS_TEST_NOW"].flatMap(Double.init).map(Date.init(timeIntervalSince1970:)) ?? .now
    }

    private static func run() throws -> AppSnapshot {
        let place = try location()
        let fd = Darwin.open(place.directory.appendingPathComponent("focus.lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw InputError(message: "Cannot open focus lock") }
        defer { flock(fd, LOCK_UN); close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw InputError(message: "Cannot lock focus store") }
        let store = try NotchFlowStore(url: place.store, cloudKitContainerIdentifier: nil)
        let repository = try NotchFlowRepository(store: store)
        let command = CommandLine.arguments.dropFirst().first ?? "snapshot"
        let snapshot = try execute(command, input: { FileHandle.standardInput.readDataToEndOfFile() }, repository: repository, place: place, now: testNow())
        if place.shared && command != "snapshot" { ExternalChangeSignal.post() }
        return snapshot
    }

    private static func execute(_ command: String, input: () -> Data, repository: NotchFlowRepository, place: Location, now: Date) throws -> AppSnapshot {
        let directory = place.directory
        func read<T: Decodable>(_ type: T.Type) throws -> T { try decode(type, input()) }
        switch command {
        case "snapshot", "notify", "notification-permission": break
        case "task-reorder":
            let order = try read(TaskOrder.self)
            var snapshot = try repository.loadSnapshot()
            guard Set(order.ids).count == order.ids.count, Set(order.ids) == Set(snapshot.tasks.map(\.id)) else {
                throw InputError(message: "Task order must contain every task exactly once")
            }
            let positions = Dictionary(uniqueKeysWithValues: order.ids.enumerated().map { ($0.element, $0.offset) })
            for index in snapshot.tasks.indices { snapshot.tasks[index].orderIndex = positions[snapshot.tasks[index].id]! }
            try repository.replaceAll(with: snapshot)
        case "task-add", "task-edit":
            let draft = try read(TaskDraft.self)
            let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { throw InputError(message: "Task title is required") }
            if command == "task-add" {
                var task = TaskItem(title: title, notes: draft.notes, projectName: draft.projectName, tags: draft.tags, priority: draft.priority, dueDate: draft.dueDate)
                let snapshot = try repository.loadSnapshot()
                task.orderIndex = (snapshot.tasks.map(\.orderIndex).max() ?? -1) + 1
                try repository.upsertTask(task)
                if snapshot.selectedTaskID == nil { _ = try repository.selectTask(id: task.id) }
            } else {
                guard let id = draft.id, var task = try repository.task(id: id) else { throw InputError(message: "Task does not exist") }
                task.title = title; task.notes = draft.notes; task.projectName = draft.projectName
                task.tags = draft.tags; task.priority = draft.priority; task.dueDate = draft.dueDate
                try repository.upsertTask(task)
            }
        case "task-complete":
            let value = try read(Completion.self)
            _ = try repository.setTaskCompletion(id: value.id, isCompleted: value.isCompleted)
        case "task-delete":
            let value = try read(TaskSelection.self)
            guard let id = value.id else { throw InputError(message: "Task ID is required") }
            try repository.deleteTask(id: id)
        case "task-select":
            let value = try read(TaskSelection.self)
            if let id = value.id, try repository.task(id: id) == nil { throw InputError(message: "Task does not exist") }
            _ = try repository.selectTask(id: value.id)
        case "task-clear-completed": _ = try repository.clearCompletedTasks()
        case "timer-start": _ = try repository.startTimer(now: now)
        case "timer-pause":
            try settle(repository, now: now, force: false)
            _ = try repository.pauseTimer(now: now)
        case "timer-reset": _ = try repository.resetTimer()
        case "timer-skip": try settle(repository, now: now, force: true)
        case "timer-tick": try settle(repository, now: now, force: false)
        case "settings":
            let settings = try read(AppSettings.self)
            guard (1...180).contains(settings.workDurationMinutes), (1...60).contains(settings.shortBreakMinutes),
                  (1...120).contains(settings.longBreakMinutes), (1...12).contains(settings.longBreakEvery) else {
                throw InputError(message: "Session duration or break cadence is out of range")
            }
            var snapshot = try repository.loadSnapshot()
            snapshot.settings = settings
            if !snapshot.isRunning {
                snapshot.remainingSeconds = min(snapshot.remainingSeconds, FocusFlowPlanner.duration(for: snapshot.activePhase, settings: settings))
                if snapshot.remainingSeconds == 0 { snapshot.remainingSeconds = FocusFlowPlanner.duration(for: snapshot.activePhase, settings: settings) }
            }
            try repository.saveAppState(from: snapshot)
        case "check-in":
            let value = try read(CheckInDraft.self)
            _ = try repository.saveCheckIn(day: value.day, mood: value.mood, text: value.text)
        case "import-original":
            let request = try read(ImportRequest.self)
            if place.shared && request.source == nil { break }
            if FileManager.default.fileExists(atPath: directory.appendingPathComponent("notchflow-imported.json").path) {
                try mergeOriginal(repository, source: request.source)
            } else {
                try importOriginal(repository, directory: directory, source: request.source)
            }
        case "use-notchflow-store":
            guard !place.shared else { break }
            try moveToNotchFlowStore(repository, directory: directory)
            return try NotchFlowRepository(store: NotchFlowStore(url: StoreLocation.defaultURL(), cloudKitContainerIdentifier: nil)).loadSnapshot()
        default: throw InputError(message: "Unknown focus command")
        }
        var snapshot = try repository.loadSnapshot()
        if snapshot.isRunning, let end = snapshot.phaseEndDate { snapshot.remainingSeconds = max(0, Int(ceil(end.timeIntervalSince(now)))) }
        return snapshot
    }

    private struct ServeRequest: Decodable { let id: Int; let command: String; let now: Double? }

    @MainActor private static var signalledAt = Date.distantPast
    @MainActor private static var pendingChange: DispatchWorkItem?

    @MainActor private static var channel = FileHandle.standardOutput

    @MainActor private static func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        // BuddyMac closing its end means nobody is listening any more.
        do { try channel.write(contentsOf: data + Data("\n".utf8)) } catch { exit(0) }
    }

    /// Launched by LaunchServices, the helper has no pipe to BuddyMac, so it dials the socket BuddyMac listens on.
    /// LaunchServices is what gives it the background-task service CloudKit needs to export changes.
    private static func connect(to path: String) throws -> FileHandle {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw InputError(message: "Cannot create the BuddyMac socket") }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else { close(fd); throw InputError(message: "BuddyMac socket path is too long") }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            buffer.copyBytes(from: bytes)
            buffer[bytes.count] = 0
        }
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard result == 0 else { close(fd); throw InputError(message: "Cannot reach BuddyMac") }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    @MainActor private static func changed() {
        pendingChange?.cancel()
        let work = DispatchWorkItem { MainActor.assumeIsolated { emit(["event": "changed"]) } }
        pendingChange = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    /// Long-lived mode. One process owns the store so CloudKit can mirror it, and BuddyMac sends one JSON line per request.
    @MainActor private static func serve() async {
        do {
            let arguments = CommandLine.arguments
            var input = FileHandle.standardInput
            if let index = arguments.firstIndex(of: "--socket"), index + 1 < arguments.count {
                let socket = try connect(to: arguments[index + 1])
                input = socket
                channel = socket
            }
            let place = try location()
            let environment = ProcessInfo.processInfo.environment
            let cloud = place.shared && environment["BUDDYMAC_FOCUS_NO_CLOUD"] != "1" ? NotchFlowStore.entitledCloudKitContainer() : nil
            let store = try NotchFlowStore(url: place.store, cloudKitContainerIdentifier: cloud)
            let repository = try NotchFlowRepository(store: store)
            DistributedNotificationCenter.default().addObserver(forName: ExternalChangeSignal.name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { if Date.now.timeIntervalSince(signalledAt) > 1 { changed() } }
            }
            NotificationCenter.default.addObserver(forName: NSPersistentCloudKitContainer.eventChangedNotification, object: nil, queue: .main) { note in
                let event = note.userInfo?[NSPersistentCloudKitContainer.eventNotificationUserInfoKey] as? NSPersistentCloudKitContainer.Event
                guard event?.type == .import, event?.endDate != nil else { return }
                MainActor.assumeIsolated { changed() }
            }
            NotificationCenter.default.addObserver(forName: .NSPersistentStoreRemoteChange, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { changed() }
            }
            emit(["event": "ready", "cloudKit": cloud != nil, "shared": place.shared, "store": place.store.path])
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            for try await line in input.bytes.lines {
                let data = Data(line.utf8)
                guard let request = try? decode(ServeRequest.self, data) else { continue }
                do {
                    store.resetContext()
                    let payload = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["payload"]
                    let input = { payload.flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) } ?? Data() }
                    let before = request.command == "timer-tick" ? try repository.loadSnapshot().activePhase : nil
                    let now = request.now.map(Date.init(timeIntervalSince1970:)) ?? testNow()
                    let snapshot = try execute(request.command, input: input, repository: repository, place: place, now: now)
                    let wrote = request.command != "snapshot" && (request.command != "timer-tick" || before != snapshot.activePhase)
                    if wrote && place.shared { signalledAt = .now; ExternalChangeSignal.post() }
                    let value = try JSONSerialization.jsonObject(with: encoder.encode(snapshot))
                    emit(["id": request.id, "ok": true, "snapshot": value])
                } catch {
                    emit(["id": request.id, "ok": false, "error": error.localizedDescription])
                }
            }
        } catch {
            FileHandle.standardError.write(Data("BuddyMac Focus: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
        exit(0)
    }

    private static func settle(_ repository: NotchFlowRepository, now: Date, force: Bool) throws {
        var snapshot = try repository.loadSnapshot()
        guard force || (snapshot.isRunning && snapshot.phaseEndDate.map { $0 <= now } == true) else { return }
        let finished = snapshot.activePhase
        if !force && finished == .work {
            snapshot.completedWorkSessions += 1
            let selected = snapshot.tasks.first { $0.id == snapshot.selectedTaskID }
            snapshot.sessionHistory.insert(FocusSession(taskID: selected?.id, taskTitle: selected?.title ?? "Inbox", phase: .work,
                finishedAt: snapshot.phaseEndDate ?? now, durationSeconds: FocusFlowPlanner.duration(for: .work, settings: snapshot.settings)), at: 0)
            if let index = snapshot.tasks.firstIndex(where: { $0.id == snapshot.selectedTaskID }) { snapshot.tasks[index].pomodorosCompleted += 1 }
        }
        snapshot.activePhase = FocusFlowPlanner.nextPhase(after: finished, completedWorkSessions: snapshot.completedWorkSessions, settings: snapshot.settings)
        snapshot.remainingSeconds = FocusFlowPlanner.duration(for: snapshot.activePhase, settings: snapshot.settings)
        snapshot.isRunning = snapshot.settings.autoStartNextPhase
        snapshot.phaseEndDate = snapshot.isRunning ? now.addingTimeInterval(TimeInterval(snapshot.remainingSeconds)) : nil
        try repository.replaceAll(with: snapshot)
    }

    private static func originalSnapshot(source: String?) throws -> AppSnapshot {
        let fm = FileManager.default
        let sourceURL = source.map { URL(fileURLWithPath: $0) }
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/NotchFlow/NotchFlow.store")
        guard fm.fileExists(atPath: sourceURL.path) else { throw InputError(message: "NotchFlow store is not present") }
        let temporary = fm.temporaryDirectory.appendingPathComponent("buddymac-focus-import-\(UUID().uuidString)")
        try fm.createDirectory(at: temporary, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: temporary) }
        let copy = temporary.appendingPathComponent("NotchFlow.store")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        process.arguments = ["-readonly", sourceURL.path, ".backup '\(copy.path.replacingOccurrences(of: "'", with: "''"))'"]
        let errors = Pipe(); process.standardError = errors
        try process.run(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw InputError(message: "Cannot take a read-only backup of NotchFlow") }
        return try NotchFlowRepository(store: NotchFlowStore(url: copy, cloudKitContainerIdentifier: nil)).loadSnapshot()
    }

    /// Brings changes made in NotchFlow after the first import into BuddyMac. Records only BuddyMac has stay;
    /// BuddyMac's edits win for shared tasks, except that completion and pomodoro counts only move forward.
    private static func mergeOriginal(_ repository: NotchFlowRepository, source: String?) throws {
        var current = try repository.loadSnapshot()
        merge(try originalSnapshot(source: source), into: &current)
        try repository.replaceAll(with: current)
    }

    private static func merge(_ original: AppSnapshot, into current: inout AppSnapshot) {
        var nextOrder = (current.tasks.map(\.orderIndex).max() ?? -1) + 1
        for task in original.tasks.sorted(by: { $0.orderIndex < $1.orderIndex }) {
            if let index = current.tasks.firstIndex(where: { $0.id == task.id }) {
                if task.isCompleted { current.tasks[index].isCompleted = true }
                current.tasks[index].pomodorosCompleted = max(current.tasks[index].pomodorosCompleted, task.pomodorosCompleted)
            } else {
                var added = task
                added.orderIndex = nextOrder
                nextOrder += 1
                current.tasks.append(added)
            }
        }
        let sessions = Set(current.sessionHistory.map(\.id))
        current.sessionHistory += original.sessionHistory.filter { !sessions.contains($0.id) }
        for entry in original.checkIns {
            if let index = current.checkIns.firstIndex(where: { $0.id == entry.id || Calendar.current.isDate($0.day, inSameDayAs: entry.day) }) {
                if entry.updatedAt > current.checkIns[index].updatedAt { current.checkIns[index] = entry }
            } else { current.checkIns.append(entry) }
        }
    }

    /// Folds BuddyMac-only records into NotchFlow's store after a private backup, then points BuddyMac at it.
    /// NotchFlow's copy wins for shared tasks because it has the phone's edits; completion and pomodoros only move forward.
    private static func moveToNotchFlowStore(_ repository: NotchFlowRepository, directory: URL) throws {
        let fm = FileManager.default
        let target = try StoreLocation.defaultURL()
        if fm.fileExists(atPath: target.path) {
            let stamp = ISO8601DateFormatter().string(from: .now).replacingOccurrences(of: ":", with: "-")
            let backup = directory.appendingPathComponent("NotchFlow-backup-\(stamp).store")
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
            process.arguments = ["-readonly", target.path, ".backup '\(backup.path.replacingOccurrences(of: "'", with: "''"))'"]
            process.standardError = Pipe()
            try process.run(); process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw InputError(message: "Cannot back up the NotchFlow store") }
        }
        let own = try repository.loadSnapshot()
        let shared = try NotchFlowRepository(store: NotchFlowStore(url: target, cloudKitContainerIdentifier: nil))
        var merged = try shared.loadSnapshot()
        merge(own, into: &merged)
        try shared.replaceAll(with: merged)
        try Data("{\"store\":\"notchflow\",\"version\":1}\n".utf8).write(to: directory.appendingPathComponent("location.json"), options: .atomic)
        ExternalChangeSignal.post()
    }

    private static func importOriginal(_ repository: NotchFlowRepository, directory: URL, source: String?) throws {
        let marker = directory.appendingPathComponent("notchflow-imported.json")
        let fm = FileManager.default
        if fm.fileExists(atPath: marker.path) { return }
        let current = try repository.loadSnapshot()
        guard current.tasks.isEmpty && current.sessionHistory.isEmpty && current.checkIns.isEmpty else {
            throw InputError(message: "Import requires an empty BuddyMac Focus store")
        }
        let sourceURL = source.map { URL(fileURLWithPath: $0) }
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/NotchFlow/NotchFlow.store")
        guard fm.fileExists(atPath: sourceURL.path) else { throw InputError(message: "NotchFlow store is not present") }
        let temporary = fm.temporaryDirectory.appendingPathComponent("buddymac-focus-import-\(UUID().uuidString)")
        try fm.createDirectory(at: temporary, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: temporary) }
        let copy = temporary.appendingPathComponent("NotchFlow.store")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        process.arguments = ["-readonly", sourceURL.path, ".backup '\(copy.path.replacingOccurrences(of: "'", with: "''"))'"]
        let errors = Pipe(); process.standardError = errors
        try process.run(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw InputError(message: "Cannot take a read-only backup of NotchFlow") }
        let copiedStore = try NotchFlowStore(url: copy, cloudKitContainerIdentifier: nil)
        let copiedRepository = try NotchFlowRepository(store: copiedStore)
        var snapshot = try copiedRepository.loadSnapshot()
        if snapshot.isRunning, let end = snapshot.phaseEndDate { snapshot.remainingSeconds = max(0, Int(ceil(end.timeIntervalSinceNow))) }
        snapshot.isRunning = false; snapshot.phaseEndDate = nil
        try repository.replaceAll(with: snapshot)
        try Data("{\"version\":1,\"cloudKit\":false}\n".utf8).write(to: marker, options: .atomic)
    }
}
