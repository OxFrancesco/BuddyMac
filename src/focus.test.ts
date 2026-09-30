import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseFocusSnapshot, type FocusSettings } from './focus'

const helper = resolve(import.meta.dir, '../dist/buddymac-focus')
async function call(home: string, command: string, payload?: unknown, now?: number) {
  const child = Bun.spawn([helper, command], { env: { ...process.env, BUDDYMAC_FOCUS_HOME: home, BUDDYMAC_FOCUS_DISABLE_ALERTS: '1', ...(now === undefined ? {} : { BUDDYMAC_FOCUS_TEST_NOW: String(now) }) }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  if (payload !== undefined) child.stdin.write(JSON.stringify(payload))
  child.stdin.end()
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(error)
  return parseFocusSnapshot(JSON.parse(output))
}
const draft = { title: 'Synthetic focus test', notes: 'Fixture', projectName: 'Test', tags: ['test'], priority: 'p2', dueDate: '2026-09-28T12:00:00Z' }

describe('Focus native persistence', () => {
  test('skipping fresh work gives a short break; every fourth completed session gives a long break', async () => {
    const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-cadence-'))
    try {
      let s = await call(home, 'timer-skip', undefined, 1000)
      expect(s.activePhase).toBe('shortBreak')
      expect(s.completedWorkSessions).toBe(0)
      expect(s.sessionHistory).toHaveLength(0)
      await call(home, 'settings', { ...s.settings, workDurationMinutes: 1, longBreakEvery: 4, autoStartNextPhase: false })
      for (let completed = 1; completed <= 8; completed++) {
        const now = 1000 + completed * 100
        s = await call(home, 'timer-skip', undefined, now)
        expect(s.activePhase).toBe('work')
        await call(home, 'timer-start', undefined, now)
        s = await call(home, 'timer-tick', undefined, now + 60)
        expect(s.activePhase).toBe(completed % 4 === 0 ? 'longBreak' : 'shortBreak')
        expect(s.completedWorkSessions).toBe(completed)
        expect(s.sessionHistory).toHaveLength(completed)
      }
    } finally { await rm(home, { recursive: true, force: true }) }
  }, 15_000)
  test('task mutations, deadline completion, idempotency, check-ins and isolated import', async () => {
    const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-test-'))
    const imported = await mkdtemp(join(tmpdir(), 'buddymac-focus-import-test-'))
    try {
      expect((await call(home, 'snapshot')).tasks).toHaveLength(0)
      let s = await call(home, 'task-add', draft)
      const task = s.tasks[0]!
      expect(s.selectedTaskID).toBe(task.id)
      s = await call(home, 'task-edit', { ...draft, title: 'Edited fixture', id: task.id })
      expect(s.tasks[0]?.title).toBe('Edited fixture')
      s = await call(home, 'task-add', { ...draft, title: 'Second fixture' })
      const second = s.tasks.find(item => item.id !== task.id)!
      s = await call(home, 'task-reorder', { ids: [second.id, task.id] })
      expect(s.tasks.map(item => item.id)).toEqual([second.id, task.id])
      await call(home, 'task-delete', { id: second.id })
      const settings: FocusSettings = { ...s.settings, workDurationMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 2, longBreakEvery: 2 }
      await call(home, 'settings', settings)
      await call(home, 'timer-reset')
      s = await call(home, 'timer-start', undefined, 1000)
      expect(s.remainingSeconds).toBe(60)
      const live = await call(home, 'snapshot', undefined, 1020)
      expect(live.remainingSeconds).toBe(40)
      expect(live.sessionHistory).toHaveLength(0)
      const overdue = await call(home, 'snapshot', undefined, 1061)
      expect(overdue.remainingSeconds).toBe(0)
      expect(overdue.activePhase).toBe('work')
      expect(overdue.sessionHistory).toHaveLength(0)
      s = await call(home, 'timer-tick', undefined, 1061)
      expect(s.activePhase).toBe('shortBreak')
      expect(s.sessionHistory).toHaveLength(1)
      expect(s.tasks[0]?.pomodorosCompleted).toBe(1)
      const repeated = await call(home, 'timer-tick', undefined, 1062)
      expect(repeated.sessionHistory).toHaveLength(1)
      await call(home, 'check-in', { day: '2026-09-28T10:00:00Z', mood: 3, text: 'Fixture' })
      s = await call(home, 'check-in', { day: '2026-09-28T12:00:00Z', mood: 4, text: 'Updated fixture' })
      expect(s.checkIns).toHaveLength(1)
      const source = join(home, 'Focus.store')
      const before = await readFile(source)
      const copy = await call(imported, 'import-original', { source })
      expect(copy.tasks).toEqual(s.tasks)
      expect(copy.sessionHistory).toEqual(s.sessionHistory)
      expect(copy.checkIns).toEqual(s.checkIns)
      expect(await readFile(source)).toEqual(before)
      expect((await call(imported, 'import-original', { source })).tasks).toHaveLength(1)
      s = await call(home, 'task-complete', { id: task.id, isCompleted: true })
      expect(s.tasks[0]?.isCompleted).toBe(true)
      expect(s.selectedTaskID).toBeUndefined()
      s = await call(home, 'task-delete', { id: task.id })
      expect(s.tasks).toHaveLength(0)
      expect((await call(home, 'snapshot')).tasks).toHaveLength(0)
    } finally { await rm(home, { recursive: true, force: true }); await rm(imported, { recursive: true, force: true }) }
  }, 30_000)
  test('selection, reopening and clearing completed tasks preserve the remaining task', async () => {
    const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-tasks-'))
    try {
      let s = await call(home, 'task-add', draft)
      const first = s.tasks[0]!.id
      s = await call(home, 'task-add', { ...draft, title: 'Second fixture' })
      const second = s.tasks.find(item => item.id !== first)!.id
      expect((await call(home, 'task-select', { id: second })).selectedTaskID).toBe(second)
      expect((await call(home, 'task-select', { id: null })).selectedTaskID).toBeUndefined()
      await call(home, 'task-select', { id: first })
      s = await call(home, 'task-complete', { id: first, isCompleted: true })
      expect(s.selectedTaskID).toBe(second)
      s = await call(home, 'task-complete', { id: first, isCompleted: false })
      expect(s.tasks.find(task => task.id === first)?.isCompleted).toBe(false)
      await call(home, 'task-complete', { id: first, isCompleted: true })
      s = await call(home, 'task-clear-completed')
      expect(s.tasks.map(task => task.id)).toEqual([second])
      expect(s.selectedTaskID).toBe(second)
      expect((await call(home, 'task-clear-completed')).tasks).toEqual(s.tasks)
      const edited = await call(home, 'task-edit', { ...draft, id: second, dueDate: null, notes: 'Changed', tags: ['one', 'two'], priority: 'p1' })
      expect(edited.tasks[0]).toMatchObject({ dueDate: undefined, notes: 'Changed', tags: ['one', 'two'], priority: 'p1' })
    } finally { await rm(home, { recursive: true, force: true }) }
  })
  test('pause/resume, reset, skip, automatic phases and long-break cadence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-timer-'))
    try {
      let s = await call(home, 'snapshot')
      const settings = { ...s.settings, workDurationMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 2, longBreakEvery: 2, autoStartNextPhase: true, notificationsEnabled: true, playSoundOnTransitions: true }
      expect((await call(home, 'settings', settings)).settings).toEqual(settings)
      await call(home, 'timer-reset')
      await call(home, 'timer-start', undefined, 1000)
      s = await call(home, 'timer-start', undefined, 1010)
      expect(s.phaseEndDate).toBe(new Date(1060_000).toISOString().replace('.000Z', 'Z'))
      s = await call(home, 'timer-pause', undefined, 1020)
      expect(s.isRunning).toBe(false)
      expect(s.remainingSeconds).toBe(40)
      expect(s.phaseEndDate).toBeUndefined()
      expect((await call(home, 'snapshot', undefined, 5000)).remainingSeconds).toBe(40)
      await call(home, 'timer-start', undefined, 2000)
      s = await call(home, 'timer-tick', undefined, 2040)
      expect(s.activePhase).toBe('shortBreak')
      expect(s.isRunning).toBe(true)
      expect(s.sessionHistory).toHaveLength(1)
      s = await call(home, 'timer-tick', undefined, 2100)
      expect(s.activePhase).toBe('work')
      expect(s.sessionHistory).toHaveLength(1)
      s = await call(home, 'timer-pause', undefined, 2160)
      expect(s.activePhase).toBe('longBreak')
      expect(s.remainingSeconds).toBe(120)
      expect(s.isRunning).toBe(false)
      expect(s.completedWorkSessions).toBe(2)
      expect(s.sessionHistory).toHaveLength(2)
      s = await call(home, 'timer-skip', undefined, 2200)
      expect(s.activePhase).toBe('work')
      expect(s.isRunning).toBe(true)
      s = await call(home, 'timer-reset', undefined, 2210)
      expect(s.remainingSeconds).toBe(60)
      expect(s.isRunning).toBe(false)
      s = await call(home, 'timer-skip', undefined, 2220)
      expect(s.completedWorkSessions).toBe(2)
      expect(s.sessionHistory).toHaveLength(2)
      expect((await call(home, 'notify', { title: 'Synthetic', message: 'Fixture', notification: true, sound: true })).tasks).toEqual([])
      await call(home, 'notification-permission')
    } finally { await rm(home, { recursive: true, force: true }) }
  })
  test('invalid task/settings/check-in/reorder input leaves persisted data intact', async () => {
    const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-invalid-'))
    try {
      const s = await call(home, 'task-add', draft)
      const id = s.tasks[0]!.id
      const missing = '00000000-0000-0000-0000-000000000000'
      await expect(call(home, 'task-add', { ...draft, title: '   ' })).rejects.toThrow('title is required')
      await expect(call(home, 'task-edit', { ...draft, id: missing })).rejects.toThrow('does not exist')
      await expect(call(home, 'task-select', { id: missing })).rejects.toThrow('does not exist')
      await expect(call(home, 'task-reorder', { ids: [] })).rejects.toThrow('every task exactly once')
      await expect(call(home, 'task-reorder', { ids: [id, id] })).rejects.toThrow('every task exactly once')
      await expect(call(home, 'settings', { ...s.settings, workDurationMinutes: 0 })).rejects.toThrow('out of range')
      await expect(call(home, 'settings', { ...s.settings, shortBreakMinutes: 61 })).rejects.toThrow('out of range')
      await expect(call(home, 'check-in', { day: '2026-09-28T12:00:00Z', mood: 6, text: 'Invalid fixture' })).rejects.toThrow()
      await expect(call(home, 'unknown')).rejects.toThrow('Unknown focus command')
      expect(await call(home, 'snapshot')).toEqual(s)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
  test('running import is paused and an occupied destination refuses migration', async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), 'buddymac-focus-import-source-'))
    const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-import-paused-'))
    const occupied = await mkdtemp(join(tmpdir(), 'buddymac-focus-import-occupied-'))
    try {
      await call(sourceHome, 'task-add', draft)
      await call(sourceHome, 'timer-start')
      const original = await call(sourceHome, 'snapshot')
      const source = join(sourceHome, 'Focus.store')
      const bytes = await readFile(source)
      const imported = await call(home, 'import-original', { source })
      expect(imported.tasks).toEqual(original.tasks)
      expect(imported.isRunning).toBe(false)
      expect(imported.phaseEndDate).toBeUndefined()
      expect(await readFile(source)).toEqual(bytes)
      const existing = await call(occupied, 'task-add', { ...draft, title: 'Occupied synthetic store' })
      await expect(call(occupied, 'import-original', { source })).rejects.toThrow('empty BuddyMac Focus store')
      expect((await call(occupied, 'snapshot')).tasks).toEqual(existing.tasks)
    } finally { for (const directory of [sourceHome, home, occupied]) await rm(directory, { recursive: true, force: true }) }
  })
  test('rejects malformed service response', () => expect(() => parseFocusSnapshot({ tasks: [] })).toThrow())
})
