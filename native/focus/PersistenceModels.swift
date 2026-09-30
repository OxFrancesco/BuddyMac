import Foundation
import SwiftData

@Model
final class TaskRecord {
    var id: UUID = UUID()
    var title: String = ""
    var notes: String = ""
    var projectName: String = ""
    var tagsRaw: String = ""
    var priorityRaw: String = TaskPriority.p3.rawValue
    var dueDate: Date?
    var isCompleted: Bool = false
    var pomodorosCompleted: Int = 0
    var orderIndex: Int = 0
    var createdAt: Date = Date()

    init(task: TaskItem) {
        id = task.id
        title = task.title
        notes = task.notes
        projectName = task.projectName
        tagsRaw = task.tags.joined(separator: "\n")
        priorityRaw = task.priority.rawValue
        dueDate = task.dueDate
        isCompleted = task.isCompleted
        pomodorosCompleted = task.pomodorosCompleted
        orderIndex = task.orderIndex
        createdAt = task.createdAt
    }

    var tags: [String] {
        get {
            tagsRaw
                .split(separator: "\n")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        set {
            tagsRaw = newValue.joined(separator: "\n")
        }
    }

    var priority: TaskPriority {
        get { TaskPriority(rawValue: priorityRaw) ?? .p3 }
        set { priorityRaw = newValue.rawValue }
    }

    func apply(_ task: TaskItem) {
        title = task.title
        notes = task.notes
        projectName = task.projectName
        tags = task.tags
        priority = task.priority
        dueDate = task.dueDate
        isCompleted = task.isCompleted
        pomodorosCompleted = task.pomodorosCompleted
        orderIndex = task.orderIndex
        createdAt = task.createdAt
    }

    func asTaskItem() -> TaskItem {
        TaskItem(
            id: id,
            title: title,
            notes: notes,
            projectName: projectName,
            tags: tags,
            priority: priority,
            dueDate: dueDate,
            isCompleted: isCompleted,
            pomodorosCompleted: pomodorosCompleted,
            orderIndex: orderIndex,
            createdAt: createdAt
        )
    }
}

@Model
final class FocusSessionRecord {
    var id: UUID = UUID()
    var taskID: UUID?
    var taskTitleSnapshot: String = ""
    var phaseRaw: String = PomodoroPhase.work.rawValue
    var finishedAt: Date = Date()
    var durationSeconds: Int = 0

    init(session: FocusSession) {
        id = session.id
        taskID = session.taskID
        taskTitleSnapshot = session.taskTitle
        phaseRaw = session.phase.rawValue
        finishedAt = session.finishedAt
        durationSeconds = session.durationSeconds
    }

    var phase: PomodoroPhase {
        get { PomodoroPhase(rawValue: phaseRaw) ?? .work }
        set { phaseRaw = newValue.rawValue }
    }

    func apply(_ session: FocusSession) {
        taskID = session.taskID
        taskTitleSnapshot = session.taskTitle
        phase = session.phase
        finishedAt = session.finishedAt
        durationSeconds = session.durationSeconds
    }

    func asFocusSession() -> FocusSession {
        FocusSession(
            id: id,
            taskID: taskID,
            taskTitle: taskTitleSnapshot,
            phase: phase,
            finishedAt: finishedAt,
            durationSeconds: durationSeconds
        )
    }
}

@Model
final class DailyCheckInRecord {
    var id: UUID = UUID()
    var day: Date = Date()
    var moodRaw: Int = DailyMood.neutral.rawValue
    var text: String = ""
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    init(checkIn: DailyCheckIn) {
        id = checkIn.id
        day = checkIn.day
        mood = checkIn.mood
        text = checkIn.text
        createdAt = checkIn.createdAt
        updatedAt = checkIn.updatedAt
    }

    var mood: DailyMood {
        get { DailyMood(rawValue: moodRaw) ?? .neutral }
        set { moodRaw = newValue.rawValue }
    }

    func apply(_ checkIn: DailyCheckIn) {
        day = checkIn.day
        mood = checkIn.mood
        text = checkIn.text
        createdAt = checkIn.createdAt
        updatedAt = checkIn.updatedAt
    }

    func asDailyCheckIn() -> DailyCheckIn {
        DailyCheckIn(
            id: id,
            day: day,
            mood: mood,
            text: text,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

@Model
final class AppStateRecord {
    var singletonID: String = NotchFlowRepository.singletonID
    var selectedTaskID: UUID?
    var activePhaseRaw: String = PomodoroPhase.work.rawValue
    var remainingSeconds: Int = FocusFlowPlanner.duration(for: .work, settings: AppSettings())
    var completedWorkSessions: Int = 0
    var workDurationMinutes: Int = 25
    var shortBreakMinutes: Int = 5
    var longBreakMinutes: Int = 15
    var longBreakEvery: Int = 4
    var notificationsEnabled: Bool = true
    var playSoundOnTransitions: Bool = true
    var autoStartNextPhase: Bool = false
    var isRunning: Bool = false
    var phaseEndDate: Date?

    init(
        singletonID: String = NotchFlowRepository.singletonID,
        selectedTaskID: UUID? = nil,
        activePhase: PomodoroPhase = .work,
        remainingSeconds: Int = FocusFlowPlanner.duration(for: .work, settings: AppSettings()),
        completedWorkSessions: Int = 0,
        settings: AppSettings = AppSettings(),
        isRunning: Bool = false,
        phaseEndDate: Date? = nil
    ) {
        self.singletonID = singletonID
        self.selectedTaskID = selectedTaskID
        activePhaseRaw = activePhase.rawValue
        self.remainingSeconds = remainingSeconds
        self.completedWorkSessions = completedWorkSessions
        workDurationMinutes = settings.workDurationMinutes
        shortBreakMinutes = settings.shortBreakMinutes
        longBreakMinutes = settings.longBreakMinutes
        longBreakEvery = settings.longBreakEvery
        notificationsEnabled = settings.notificationsEnabled
        playSoundOnTransitions = settings.playSoundOnTransitions
        autoStartNextPhase = settings.autoStartNextPhase
        self.isRunning = isRunning
        self.phaseEndDate = phaseEndDate
    }

    var activePhase: PomodoroPhase {
        get { PomodoroPhase(rawValue: activePhaseRaw) ?? .work }
        set { activePhaseRaw = newValue.rawValue }
    }

    var settings: AppSettings {
        get {
            AppSettings(
                workDurationMinutes: workDurationMinutes,
                shortBreakMinutes: shortBreakMinutes,
                longBreakMinutes: longBreakMinutes,
                longBreakEvery: longBreakEvery,
                notificationsEnabled: notificationsEnabled,
                playSoundOnTransitions: playSoundOnTransitions,
                autoStartNextPhase: autoStartNextPhase
            )
        }
        set {
            workDurationMinutes = newValue.workDurationMinutes
            shortBreakMinutes = newValue.shortBreakMinutes
            longBreakMinutes = newValue.longBreakMinutes
            longBreakEvery = newValue.longBreakEvery
            notificationsEnabled = newValue.notificationsEnabled
            playSoundOnTransitions = newValue.playSoundOnTransitions
            autoStartNextPhase = newValue.autoStartNextPhase
        }
    }

    func apply(snapshot: AppSnapshot) {
        selectedTaskID = snapshot.selectedTaskID
        activePhase = snapshot.activePhase
        remainingSeconds = snapshot.remainingSeconds
        completedWorkSessions = snapshot.completedWorkSessions
        settings = snapshot.settings
        isRunning = snapshot.isRunning
        phaseEndDate = snapshot.phaseEndDate
    }

    func asSnapshot(tasks: [TaskItem], sessions: [FocusSession], checkIns: [DailyCheckIn]) -> AppSnapshot {
        AppSnapshot(
            tasks: tasks,
            selectedTaskID: selectedTaskID,
            activePhase: activePhase,
            remainingSeconds: remainingSeconds,
            completedWorkSessions: completedWorkSessions,
            settings: settings,
            sessionHistory: sessions,
            checkIns: checkIns,
            isRunning: isRunning,
            phaseEndDate: phaseEndDate
        )
    }
}
