import { dirname, resolve } from 'node:path'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { CString, dlopen, FFIType, ptr } from 'bun:ffi'

export type FocusPhase = 'work' | 'shortBreak' | 'longBreak'
export type TaskPriority = 'p1' | 'p2' | 'p3' | 'p4'
export interface FocusTask {
  id: string; title: string; notes: string; projectName: string; tags: string[]
  priority: TaskPriority; dueDate?: string; isCompleted: boolean
  pomodorosCompleted: number; orderIndex: number; createdAt: string
}
export type FocusTaskDraft = Pick<FocusTask, 'title' | 'notes' | 'projectName' | 'tags' | 'priority' | 'dueDate'>
export interface FocusSettings {
  workDurationMinutes: number; shortBreakMinutes: number; longBreakMinutes: number
  longBreakEvery: number; notificationsEnabled: boolean; playSoundOnTransitions: boolean; autoStartNextPhase: boolean
}
export interface FocusSession { id: string; taskID?: string; taskTitle: string; phase: FocusPhase; finishedAt: string; durationSeconds: number }
export interface FocusCheckIn { id: string; day: string; mood: 1 | 2 | 3 | 4 | 5; text: string; createdAt: string; updatedAt: string }
export interface FocusSnapshot {
  tasks: FocusTask[]; selectedTaskID?: string; activePhase: FocusPhase; remainingSeconds: number
  completedWorkSessions: number; settings: FocusSettings; sessionHistory: FocusSession[]
  checkIns: FocusCheckIn[]; isRunning: boolean; phaseEndDate?: string
}

const invalid = () => new Error('The Focus service returned invalid data.')
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid()
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string { if (typeof value !== 'string') throw invalid(); return value }
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(); return value }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw invalid(); return value }
function optionalString(value: unknown): string | undefined { return value == null ? undefined : string(value) }
function array<T>(value: unknown, parse: (item: unknown) => T): T[] { if (!Array.isArray(value)) throw invalid(); return value.map(parse) }
function phase(value: unknown): FocusPhase { if (value !== 'work' && value !== 'shortBreak' && value !== 'longBreak') throw invalid(); return value }
function priority(value: unknown): TaskPriority { if (value !== 'p1' && value !== 'p2' && value !== 'p3' && value !== 'p4') throw invalid(); return value }
function mood(value: unknown): FocusCheckIn['mood'] { if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) throw invalid(); return value }
export function parseFocusSnapshot(value: unknown): FocusSnapshot {
  const v = object(value); const s = object(v.settings)
  return {
    tasks: array(v.tasks, value => { const t = object(value); return {
      id: string(t.id), title: string(t.title), notes: string(t.notes), projectName: string(t.projectName), tags: array(t.tags, string),
      priority: priority(t.priority), dueDate: optionalString(t.dueDate), isCompleted: bool(t.isCompleted),
      pomodorosCompleted: number(t.pomodorosCompleted), orderIndex: number(t.orderIndex), createdAt: string(t.createdAt),
    }}),
    selectedTaskID: optionalString(v.selectedTaskID), activePhase: phase(v.activePhase), remainingSeconds: number(v.remainingSeconds),
    completedWorkSessions: number(v.completedWorkSessions), isRunning: bool(v.isRunning), phaseEndDate: optionalString(v.phaseEndDate),
    settings: { workDurationMinutes: number(s.workDurationMinutes), shortBreakMinutes: number(s.shortBreakMinutes), longBreakMinutes: number(s.longBreakMinutes),
      longBreakEvery: number(s.longBreakEvery), notificationsEnabled: bool(s.notificationsEnabled), playSoundOnTransitions: bool(s.playSoundOnTransitions), autoStartNextPhase: bool(s.autoStartNextPhase) },
    sessionHistory: array(v.sessionHistory, value => { const s = object(value); return { id: string(s.id), taskID: optionalString(s.taskID), taskTitle: string(s.taskTitle), phase: phase(s.phase), finishedAt: string(s.finishedAt), durationSeconds: number(s.durationSeconds) }}),
    checkIns: array(v.checkIns, value => { const c = object(value); return { id: string(c.id), day: string(c.day), mood: mood(c.mood), text: string(c.text), createdAt: string(c.createdAt), updatedAt: string(c.updatedAt) }}),
  }
}

function helperPath(): string {
  if (process.env.BUDDYMAC_FOCUS_HELPER) return process.env.BUDDYMAC_FOCUS_HELPER
  const packaged = process.execPath.includes('.app/Contents/MacOS/')
  const bundled = packaged ? resolve(dirname(process.execPath), '../Helpers/BuddyMac Focus.app/Contents/MacOS/buddymac-focus') : resolve(import.meta.dir, '../dist/BuddyMac Focus.app/Contents/MacOS/buddymac-focus')
  if (existsSync(bundled)) return bundled
  return packaged ? resolve(dirname(process.execPath), 'buddymac-focus') : resolve(import.meta.dir, '../dist/buddymac-focus')
}

export interface FocusServiceInfo { cloudKit: boolean; shared: boolean; store: string }
type Pending = { resolve: (snapshot: FocusSnapshot) => void; reject: (error: Error) => void }
interface Channel { write(line: string): void; close(): void; pending: Map<number, Pending> }
const focusApp = (helper: string) => helper.includes('/BuddyMac Focus.app/Contents/MacOS/') ? helper.slice(0, helper.indexOf('/Contents/MacOS/')) : null
const socketPath = () => resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), 'Library/Application Support/BuddyMac'), 'Focus', `focus-${process.pid}.sock`)

/**
 * One long-lived helper owns the store so CloudKit can keep it in sync. Requests are JSON lines.
 * Packaged, the helper is its own app bundle started through LaunchServices: only a LaunchServices launch gets the
 * background-task service CloudKit schedules exports with, so it dials back over a private Unix socket.
 * In development and tests it is a plain child process on stdin and stdout.
 */
class FocusClient {
  private channel: Channel | null = null
  private next = 1
  private listeners = new Set<() => void>()
  info: FocusServiceInfo | null = null
  private receive(channel: Channel, line: string) {
    if (!line.trim()) return
    try {
      const message = object(JSON.parse(line))
      if (message.event === 'ready') this.info = { cloudKit: message.cloudKit === true, shared: message.shared === true, store: typeof message.store === 'string' ? message.store : '' }
      else if (message.event === 'changed') for (const listener of this.listeners) listener()
      else if (typeof message.id === 'number') {
        const request = channel.pending.get(message.id); channel.pending.delete(message.id)
        if (message.ok === true) request?.resolve(parseFocusSnapshot(message.snapshot))
        else request?.reject(new Error(typeof message.error === 'string' ? message.error : 'The Focus service failed.'))
      }
    } catch {}
  }
  private closed(channel: Channel) {
    if (this.channel === channel) this.channel = null
    // Only this helper's requests fail. A replacement started by close() keeps its own.
    for (const [, request] of channel.pending) request.reject(new Error('The Focus service stopped. Try again.'))
    channel.pending.clear()
  }
  private lines(channel: Channel) { let buffer = ''; return (chunk: string) => { buffer += chunk; let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); this.receive(channel, line) } } }
  private start(): Channel {
    if (this.channel) return this.channel
    const helper = helperPath()
    const bundle = focusApp(helper)
    return this.channel = bundle && process.env.BUDDYMAC_FOCUS_DIRECT !== '1' ? this.launch(bundle) : this.spawn(helper)
  }
  private spawn(helper: string): Channel {
    const child = Bun.spawn([helper, 'serve'], { env: { ...process.env }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const channel: Channel = { pending: new Map(), write: line => { child.stdin.write(line); child.stdin.flush() }, close: () => child.kill() }
    const feed = this.lines(channel)
    void (async () => { const decoder = new TextDecoder(); for await (const chunk of child.stdout) feed(decoder.decode(chunk, { stream: true })) })()
    void child.exited.then(() => this.closed(channel))
    return channel
  }
  private launch(bundle: string): Channel {
    const path = socketPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    rmSync(path, { force: true })
    let socket: { write(data: string): number; end(): void } | null = null, done = false, timeout: ReturnType<typeof setTimeout> | undefined
    const queue: string[] = []
    const channel: Channel = {
      pending: new Map(),
      write: line => { if (socket) socket.write(line); else queue.push(line) },
      close: () => { done = true; socket?.end(); listener.stop(true); rmSync(path, { force: true }); this.closed(channel) },
    }
    const feed = this.lines(channel)
    const decoder = new TextDecoder()
    const listener = Bun.listen({
      unix: path,
      socket: {
        open: connected => { if (socket) { connected.end(); return } socket = connected; clearTimeout(timeout); for (const line of queue.splice(0)) connected.write(line) },
        data: (_connected, chunk) => feed(decoder.decode(chunk, { stream: true })),
        close: () => { if (!done) channel.close() },
        error: () => { if (!done) channel.close() },
      },
    })
    chmodSync(path, 0o600)
    const environment = ['BUDDYMAC_FOCUS_HOME', 'BUDDYMAC_FOCUS_NO_CLOUD', 'BUDDYMAC_FOCUS_TEST_NOW'].flatMap(key => process.env[key] ? ['--env', `${key}=${process.env[key]}`] : [])
    const opener = Bun.spawn(['/usr/bin/open', '-g', '-j', '-n', ...environment, bundle, '--args', 'serve', '--socket', path], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
    void opener.exited.then(code => { if (code !== 0 && !socket) channel.close() })
    timeout = setTimeout(() => { if (!socket && !done) channel.close() }, 15_000)
    timeout.unref?.()
    return channel
  }
  request(command: string, payload?: unknown): Promise<FocusSnapshot> {
    const channel = this.start()
    const id = this.next++
    return new Promise((resolve, reject) => {
      channel.pending.set(id, { resolve, reject })
      channel.write(`${JSON.stringify({ id, command, ...(payload === undefined ? {} : { payload }) })}\n`)
    })
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  close() { this.channel?.close(); this.channel = null }
}
export const focusClient = new FocusClient()
const request = (command: string, payload?: unknown) => focusClient.request(command, payload)
function openNotifications() {
  const root = process.execPath.includes('.app/Contents/MacOS/') ? dirname(process.execPath) : resolve(import.meta.dir, '../dist')
  return dlopen(resolve(root, 'libbuddymac-notifications.dylib'), {
    buddymac_notifications_start: { args: [FFIType.ptr], returns: FFIType.int },
    buddymac_notifications_take: { args: [FFIType.int], returns: FFIType.ptr },
    buddymac_notifications_cancel: { args: [FFIType.int], returns: FFIType.void },
    buddymac_notifications_free: { args: [FFIType.ptr], returns: FFIType.void },
  })
}
let notifications: ReturnType<typeof openNotifications> | undefined
async function notificationRequest(payload: { operation: 'authorize' | 'notify' | 'status'; title?: string; message?: string; notification?: boolean; sound?: boolean }) {
  if (process.env.BUDDYMAC_FOCUS_DISABLE_ALERTS === '1') return { ok: true }
  const library = notifications ??= openNotifications()
  const encoded = Buffer.from(`${JSON.stringify(payload)}\0`)
  const id = library.symbols.buddymac_notifications_start(ptr(encoded))
  try {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const pointer = library.symbols.buddymac_notifications_take(id)
      if (pointer) {
        let value: unknown
        try { value = JSON.parse(new CString(pointer).toString()) } finally { library.symbols.buddymac_notifications_free(pointer) }
        const reply = object(value)
        if (reply.ok !== true) throw new Error(typeof reply.error === 'string' ? reply.error : 'Focus notification failed.')
        return reply
      }
      await Bun.sleep(50)
    }
    throw new Error('Notification authorization timed out. Try again in Focus settings.')
  } finally { library.symbols.buddymac_notifications_cancel(id) }
}
export async function focusNotificationStatus() {
  const value = await notificationRequest({ operation: 'status' })
  if (process.env.BUDDYMAC_FOCUS_DISABLE_ALERTS === '1') return { bundleIdentifier: '', authorizationStatus: 'disabledForTest', deliveredIdentifiers: [] as string[] }
  return { bundleIdentifier: string(value.bundleIdentifier), authorizationStatus: string(value.authorizationStatus), deliveredIdentifiers: array(value.deliveredIdentifiers, string) }
}
export const focus = {
  snapshot: () => request('snapshot'),
  importOriginal: (source?: string) => request('import-original', { source }),
  addTask: (draft: FocusTaskDraft) => request('task-add', draft),
  editTask: (id: string, draft: FocusTaskDraft) => request('task-edit', { ...draft, id }),
  completeTask: (id: string, isCompleted: boolean) => request('task-complete', { id, isCompleted }),
  deleteTask: (id: string) => request('task-delete', { id }),
  selectTask: (id: string | null) => request('task-select', { id }),
  clearCompleted: () => request('task-clear-completed'),
  reorderTasks: (ids: string[]) => request('task-reorder', { ids }),
  notificationPermission: async () => { await notificationRequest({ operation: 'authorize' }); return request('snapshot') },
  notify: async (title: string, message: string, settings: FocusSettings) => { await notificationRequest({ operation: 'notify', title, message, notification: settings.notificationsEnabled, sound: settings.playSoundOnTransitions }); return request('snapshot') },
  timer: (action: 'start' | 'pause' | 'reset' | 'skip' | 'tick') => request(`timer-${action}`),
  updateSettings: (settings: FocusSettings) => request('settings', settings),
  checkIn: (day: string, mood: FocusCheckIn['mood'], text: string) => request('check-in', { day, mood, text }),
  useNotchFlowStore: async () => { await request('use-notchflow-store'); focusClient.close(); return request('snapshot') },
}
