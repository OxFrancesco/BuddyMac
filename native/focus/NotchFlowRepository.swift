import Foundation
import SwiftData

package enum NotchFlowRepositoryError: Error, LocalizedError {
    case taskNotFound(UUID)

    package var errorDescription: String? {
        switch self {
        case let .taskNotFound(id):
            "Task not found: \(id.uuidString)"
        }
    }
}

package enum TaskListMode: Sendable {
    case open
    case all
    case completed
    case filtered(TaskFilter)
}

package final class NotchFlowRepository {
    static let singletonID = "main"

    package let store: NotchFlowStore
    private let calendar: Calendar

    package init(store: NotchFlowStore, calendar: Calendar = .current) throws {
        self.store = store
        self.calendar = calendar
        try bootstrapIfNeeded()
    }

    package convenience init(calendar: Calendar = .current) throws {
        try self.init(store: NotchFlowStore(), calendar: calendar)
    }

    package func loadSnapshot() throws -> AppSnapshot {
        let appState = try ensureAppState()
        let tasks = try fetchTaskItems()
        let sessions = try fetchFocusSessions()
        let checkIns = try fetchDailyCheckIns()
        return appState.asSnapshot(tasks: tasks, sessions: sessions, checkIns: checkIns)
    }

    package func replaceAll(with snapshot: AppSnapshot) throws {
        let appState = try ensureAppState()
        appState.apply(snapshot: snapshot)
        try reconcileTasks(snapshot.tasks)
        try reconcileSessions(snapshot.sessionHistory)
        try reconcileCheckIns(snapshot.checkIns)
        try saveContext()
    }

    // MARK: - Targeted write primitives (plan 005)

    package func upsertTask(_ task: TaskItem) throws {
        let id = task.id
        var descriptor = FetchDescriptor<TaskRecord>()
        descriptor.predicate = #Predicate<TaskRecord> { record in record.id == id }
        if let existing = try store.mainContext.fetch(descriptor).first {
            existing.apply(task)
        } else {
            store.mainContext.insert(TaskRecord(task: task))
        }
        try saveContext()
    }

    package func deleteTasks(ids: Set<UUID>) throws {
        guard !ids.isEmpty else { return }
        let allRecords = try store.mainContext.fetch(FetchDescriptor<TaskRecord>())
        for record in allRecords where ids.contains(record.id) {
            store.mainContext.delete(record)
        }
        try saveContext()
    }

    package func insertSession(_ session: FocusSession) throws {
        let id = session.id
        var descriptor = FetchDescriptor<FocusSessionRecord>()
        descriptor.predicate = #Predicate<FocusSessionRecord> { record in record.id == id }
        guard (try store.mainContext.fetch(descriptor).first) == nil else { return }
        store.mainContext.insert(FocusSessionRecord(session: session))
        try saveContext()
    }

    package func upsertCheckIn(_ checkIn: DailyCheckIn) throws {
        let normalizedDay = calendar.startOfDay(for: checkIn.day)
        var normalized = checkIn
        normalized.day = normalizedDay
        let allRecords = try store.mainContext.fetch(FetchDescriptor<DailyCheckInRecord>())
        let existing = allRecords.first { calendar.isDate($0.day, inSameDayAs: normalizedDay) }
        if let existing {
            existing.apply(normalized)
        } else {
            store.mainContext.insert(DailyCheckInRecord(checkIn: normalized))
        }
        try saveContext()
    }

    package func saveAppState(from snapshot: AppSnapshot) throws {
        let appState = try ensureAppState()
        appState.apply(snapshot: snapshot)
        try saveContext()
    }

    package func tasks(mode: TaskListMode = .open, search: String = "") throws -> [TaskItem] {
        let snapshot = try loadSnapshot()
        return snapshot.tasks
            .filter { task in
                switch mode {
                case .open:
                    !task.isCompleted
                case .all:
                    true
                case .completed:
                    task.isCompleted
                case let .filtered(filter):
                    filter.matches(task, calendar: calendar)
                }
            }
            .filter { task in
                let trimmedQuery = search.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmedQuery.isEmpty else { return true }
                return task.title.localizedStandardContains(trimmedQuery)
                    || task.notes.localizedStandardContains(trimmedQuery)
                    || task.projectName.localizedStandardContains(trimmedQuery)
                    || task.tags.contains(where: { $0.localizedStandardContains(trimmedQuery) })
            }
            .sorted(by: taskSort)
    }

    package func task(id: UUID) throws -> TaskItem? {
        try fetchTaskItems().first { $0.id == id }
    }

    package func addTask(
        title: String,
        notes: String = "",
        projectName: String = "",
        tags: [String] = [],
        priority: TaskPriority = .p3,
        dueDate: Date? = nil
    ) throws -> TaskItem {
        let existingTasks = try fetchTaskItems()
        let task = TaskItem(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
            projectName: projectName.trimmingCharacters(in: .whitespacesAndNewlines),
            tags: tags,
            priority: priority,
            dueDate: dueDate ?? calendar.startOfDay(for: .now),
            orderIndex: nextOrderIndex(in: existingTasks)
        )
        try upsertTask(task)
        let appState = try ensureAppState()
        if appState.selectedTaskID == nil {
            appState.selectedTaskID = task.id
            try saveContext()
        }
        return task
    }

    package func setTaskCompletion(id: UUID, isCompleted: Bool) throws -> TaskItem {
        var descriptor = FetchDescriptor<TaskRecord>()
        descriptor.predicate = #Predicate<TaskRecord> { record in record.id == id }
        guard let record = try store.mainContext.fetch(descriptor).first else {
            throw NotchFlowRepositoryError.taskNotFound(id)
        }
        record.isCompleted = isCompleted
        let appState = try ensureAppState()
        if isCompleted, appState.selectedTaskID == id {
            let remaining = try fetchTaskItems().filter { !$0.isCompleted && $0.id != id }
            appState.selectedTaskID = remaining.first?.id
        }
        try saveContext()
        return record.asTaskItem()
    }

    package func deleteTask(id: UUID) throws {
        try deleteTasks(ids: [id])
        let appState = try ensureAppState()
        if appState.selectedTaskID == id {
            let remaining = try fetchTaskItems()
            appState.selectedTaskID = remaining.first(where: { !$0.isCompleted })?.id ?? remaining.first?.id
            try saveContext()
        }
    }

    @discardableResult
    package func selectTask(id: UUID?) throws -> AppSnapshot {
        let appState = try ensureAppState()
        appState.selectedTaskID = id
        try saveContext()
        return try loadSnapshot()
    }

    @discardableResult
    package func clearCompletedTasks() throws -> Int {
        let allTasks = try fetchTaskItems()
        let completedIDs = Set(allTasks.filter(\.isCompleted).map(\.id))
        let count = completedIDs.count
        guard count > 0 else { return 0 }
        let appState = try ensureAppState()
        let selectedWasCompleted = appState.selectedTaskID.map { completedIDs.contains($0) } ?? false
        try deleteTasks(ids: completedIDs)
        if selectedWasCompleted {
            let remaining = try fetchTaskItems()
            appState.selectedTaskID = remaining.first?.id
            try saveContext()
        }
        return count
    }

    package func sessions(limit: Int? = nil, phase: PomodoroPhase? = nil) throws -> [FocusSession] {
        var sessions = try fetchFocusSessions()
        if let phase {
            sessions.removeAll(where: { $0.phase != phase })
        }
        if let limit {
            sessions = Array(sessions.prefix(max(limit, 0)))
        }
        return sessions
    }

    package func checkIns(limit: Int? = nil) throws -> [DailyCheckIn] {
        var checkIns = try fetchDailyCheckIns()
        if let limit {
            checkIns = Array(checkIns.prefix(max(limit, 0)))
        }
        return checkIns
    }

    package func checkIn(for day: Date, calendar: Calendar = .current) throws -> DailyCheckIn? {
        let normalizedDay = calendar.startOfDay(for: day)
        return try fetchDailyCheckIns().first { calendar.isDate($0.day, inSameDayAs: normalizedDay) }
    }

    @discardableResult
    package func saveCheckIn(
        day: Date,
        mood: DailyMood,
        text: String,
        calendar: Calendar = .current
    ) throws -> DailyCheckIn {
        let normalizedDay = calendar.startOfDay(for: day)
        let now = Date()
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Look for an existing record for this day so we preserve its id on update.
        let allRecords = try store.mainContext.fetch(FetchDescriptor<DailyCheckInRecord>())
        let existingRecord = allRecords.first { calendar.isDate($0.day, inSameDayAs: normalizedDay) }

        if let existingRecord {
            let updated = DailyCheckIn(
                id: existingRecord.id,
                day: normalizedDay,
                mood: mood,
                text: trimmedText,
                createdAt: existingRecord.createdAt,
                updatedAt: now
            )
            try upsertCheckIn(updated)
            return updated
        }

        let checkIn = DailyCheckIn(
            day: normalizedDay,
            mood: mood,
            text: trimmedText,
            createdAt: now,
            updatedAt: now
        )
        try upsertCheckIn(checkIn)
        return checkIn
    }

    // MARK: - Timer control operations (plan 012)

    @discardableResult
    package func startTimer(now: Date = .now) throws -> AppSnapshot {
        let appState = try ensureAppState()
        guard !appState.isRunning else { return try loadSnapshot() }
        appState.phaseEndDate = now.addingTimeInterval(TimeInterval(appState.remainingSeconds))
        appState.isRunning = true
        try saveContext()
        return try loadSnapshot()
    }

    @discardableResult
    package func pauseTimer(now: Date = .now) throws -> AppSnapshot {
        let appState = try ensureAppState()
        guard appState.isRunning else { return try loadSnapshot() }
        if let end = appState.phaseEndDate {
            appState.remainingSeconds = max(0, Int(ceil(end.timeIntervalSince(now))))
        }
        appState.phaseEndDate = nil
        appState.isRunning = false
        try saveContext()
        return try loadSnapshot()
    }

    @discardableResult
    package func resetTimer() throws -> AppSnapshot {
        let appState = try ensureAppState()
        appState.isRunning = false
        appState.phaseEndDate = nil
        appState.remainingSeconds = FocusFlowPlanner.duration(for: appState.activePhase, settings: appState.settings)
        try saveContext()
        return try loadSnapshot()
    }

    @discardableResult
    package func skipTimer() throws -> AppSnapshot {
        let appState = try ensureAppState()
        let nextPhase = FocusFlowPlanner.nextPhase(
            after: appState.activePhase,
            completedWorkSessions: appState.completedWorkSessions,
            settings: appState.settings
        )
        appState.activePhase = nextPhase
        appState.remainingSeconds = FocusFlowPlanner.duration(for: nextPhase, settings: appState.settings)
        appState.isRunning = false
        appState.phaseEndDate = nil
        try saveContext()
        return try loadSnapshot()
    }

    package func settings() throws -> AppSettings {
        try ensureAppState().settings
    }

    package func storeStatus() throws -> AppSnapshot {
        try loadSnapshot()
    }

    private func bootstrapIfNeeded() throws {
        _ = try ensureAppState()
    }

    private func ensureAppState() throws -> AppStateRecord {
        let id = Self.singletonID
        var descriptor = FetchDescriptor<AppStateRecord>()
        descriptor.predicate = #Predicate<AppStateRecord> { record in
            record.singletonID == id
        }
        if let existing = try store.mainContext.fetch(descriptor).first {
            return existing
        }

        let record = AppStateRecord()
        store.mainContext.insert(record)
        try saveContext()
        return record
    }

    private func fetchTaskItems() throws -> [TaskItem] {
        let descriptor = FetchDescriptor<TaskRecord>(sortBy: [
            SortDescriptor(\.orderIndex),
            SortDescriptor(\.createdAt),
        ])
        return try store.mainContext.fetch(descriptor).map { $0.asTaskItem() }
    }

    private func fetchFocusSessions() throws -> [FocusSession] {
        let descriptor = FetchDescriptor<FocusSessionRecord>(sortBy: [
            SortDescriptor(\.finishedAt, order: .reverse),
        ])
        return try store.mainContext.fetch(descriptor).map { $0.asFocusSession() }
    }

    private func fetchDailyCheckIns() throws -> [DailyCheckIn] {
        let descriptor = FetchDescriptor<DailyCheckInRecord>(sortBy: [
            SortDescriptor(\.day, order: .reverse),
            SortDescriptor(\.updatedAt, order: .reverse),
        ])
        return deduplicatedCheckIns(try store.mainContext.fetch(descriptor).map { $0.asDailyCheckIn() })
    }

    private func reconcileTasks(_ tasks: [TaskItem]) throws {
        let existing = try recordsByID(store.mainContext.fetch(FetchDescriptor<TaskRecord>()))
        let incomingIDs = Set(tasks.map(\.id))

        for task in tasks {
            if let record = existing[task.id] {
                record.apply(task)
            } else {
                store.mainContext.insert(TaskRecord(task: task))
            }
        }

        for (id, record) in existing where !incomingIDs.contains(id) {
            store.mainContext.delete(record)
        }
    }

    private func reconcileSessions(_ sessions: [FocusSession]) throws {
        let existing = try recordsByID(store.mainContext.fetch(FetchDescriptor<FocusSessionRecord>()))
        let incomingIDs = Set(sessions.map(\.id))

        for session in sessions {
            if let record = existing[session.id] {
                record.apply(session)
            } else {
                store.mainContext.insert(FocusSessionRecord(session: session))
            }
        }

        for (id, record) in existing where !incomingIDs.contains(id) {
            store.mainContext.delete(record)
        }
    }

    private func reconcileCheckIns(_ checkIns: [DailyCheckIn]) throws {
        let deduplicatedCheckIns = deduplicatedCheckIns(checkIns)
        let existing = try recordsByID(store.mainContext.fetch(FetchDescriptor<DailyCheckInRecord>()))
        let incomingIDs = Set(deduplicatedCheckIns.map(\.id))

        for checkIn in deduplicatedCheckIns {
            if let record = existing[checkIn.id] {
                record.apply(checkIn)
            } else {
                store.mainContext.insert(DailyCheckInRecord(checkIn: checkIn))
            }
        }

        for (id, record) in existing where !incomingIDs.contains(id) {
            store.mainContext.delete(record)
        }
    }

    private func recordsByID<Record>(_ records: [Record]) -> [UUID: Record] where Record: AnyObject {
        var result: [UUID: Record] = [:]

        for record in records {
            switch record {
            case let task as TaskRecord:
                result[task.id] = record
            case let session as FocusSessionRecord:
                result[session.id] = record
            case let checkIn as DailyCheckInRecord:
                result[checkIn.id] = record
            default:
                continue
            }
        }

        return result
    }

    private func deduplicatedCheckIns(_ checkIns: [DailyCheckIn]) -> [DailyCheckIn] {
        var byDay: [Date: DailyCheckIn] = [:]

        for checkIn in checkIns {
            let day = calendar.startOfDay(for: checkIn.day)
            var normalized = checkIn
            normalized.day = day

            if let existing = byDay[day], existing.updatedAt >= normalized.updatedAt {
                continue
            }

            byDay[day] = normalized
        }

        return byDay.values.sorted {
            if $0.day != $1.day {
                return $0.day > $1.day
            }

            return $0.updatedAt > $1.updatedAt
        }
    }

    private func saveContext() throws {
        guard store.mainContext.hasChanges else { return }
        try store.mainContext.save()
    }

    private func nextOrderIndex(in tasks: [TaskItem]) -> Int {
        (tasks.map(\.orderIndex).max() ?? -1) + 1
    }

    private func taskSort(_ lhs: TaskItem, _ rhs: TaskItem) -> Bool {
        if lhs.isCompleted != rhs.isCompleted { return !lhs.isCompleted }

        let lhsOverdue = isOverdue(lhs)
        let rhsOverdue = isOverdue(rhs)
        if lhsOverdue != rhsOverdue { return lhsOverdue }

        switch (lhs.dueDate, rhs.dueDate) {
        case let (left?, right?) where left != right:
            return left < right
        case (_?, nil):
            return true
        case (nil, _?):
            return false
        default:
            break
        }

        if lhs.priority.rank != rhs.priority.rank {
            return lhs.priority.rank < rhs.priority.rank
        }

        if lhs.orderIndex != rhs.orderIndex {
            return lhs.orderIndex < rhs.orderIndex
        }

        return lhs.createdAt < rhs.createdAt
    }

    private func isOverdue(_ task: TaskItem) -> Bool {
        guard let dueDate = task.dueDate, !task.isCompleted else { return false }
        return dueDate < calendar.startOfDay(for: .now) && !calendar.isDateInToday(dueDate)
    }
}
