import { expect, test } from 'bun:test'
import { FocusService, focusAnalytics } from './focus-state'
import type { FocusSnapshot } from './focus'
const snapshot = (): FocusSnapshot => ({ tasks: [], activePhase: 'work', remainingSeconds: 1, completedWorkSessions: 0, settings: { workDurationMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, notificationsEnabled: false, playSoundOnTransitions: false, autoStartNextPhase: false }, sessionHistory: [], checkIns: [], isRunning: true, phaseEndDate: new Date().toISOString() })
test('countdown derives from its deadline without native calls before completion', async () => {
  let now = 1_000, ticks = 0, alerts = 0
  const initial = { ...snapshot(), remainingSeconds: 60, phaseEndDate: new Date(61_000).toISOString() }
  initial.settings.notificationsEnabled = true
  const completed: FocusSnapshot = { ...initial, activePhase: 'shortBreak', remainingSeconds: 300, isRunning: false, phaseEndDate: undefined, completedWorkSessions: 1 }
  const service = new FocusService({ snapshot: async () => initial, timer: async () => { ticks++; return completed }, notify: async () => { alerts++; return completed } }, 1_000, () => now)
  await service.run(async () => initial)
  for (now = 2_000; now < 61_000; now += 1_000) await service.tick()
  expect(ticks).toBe(0)
  expect(alerts).toBe(0)
  expect(service.getSnapshot().data?.remainingSeconds).toBe(1)
  await Promise.all([service.tick(), service.tick(), service.tick()])
  await service.tick()
  expect(ticks).toBe(1)
  expect(alerts).toBe(1)
  expect(service.getSnapshot().data?.completedWorkSessions).toBe(1)
})
test('auto-started phase counts down locally after an overdue completion', async () => {
  let now = 70_000, ticks = 0
  const initial = { ...snapshot(), phaseEndDate: new Date(61_000).toISOString() }
  const next: FocusSnapshot = { ...initial, activePhase: 'shortBreak', remainingSeconds: 300, phaseEndDate: new Date(370_000).toISOString() }
  const service = new FocusService({ snapshot: async () => initial, timer: async () => { ticks++; return next }, notify: async () => next }, 1_000, () => now)
  await service.run(async () => initial)
  await service.tick()
  now = 72_001
  await service.tick()
  expect(ticks).toBe(1)
  expect(service.getSnapshot().data?.remainingSeconds).toBe(298)
})
test('queued timer completion rechecks a timer reset before calling native', async () => {
  const initial = { ...snapshot(), phaseEndDate: new Date(1_000).toISOString() }
  let ticks = 0
  const service = new FocusService({ snapshot: async () => initial, timer: async () => { ticks++; return initial }, notify: async () => initial }, 1_000, () => 2_000)
  await service.run(async () => initial)
  const reset = service.run(async () => ({ ...initial, isRunning: false, phaseEndDate: undefined, remainingSeconds: 1_500 }))
  await Promise.all([reset, service.tick()])
  expect(ticks).toBe(0)
  expect(service.getSnapshot().data?.remainingSeconds).toBe(1_500)
})
test('missing or invalid deadlines fall back to the native timer', async () => {
  for (const phaseEndDate of [undefined, 'invalid']) {
    const initial = { ...snapshot(), phaseEndDate }
    let ticks = 0
    const service = new FocusService({ snapshot: async () => initial, timer: async () => { ticks++; return initial }, notify: async () => initial })
    await service.run(async () => initial)
    await service.tick()
    expect(ticks).toBe(1)
  }
})
test('analytics excludes break sessions and counts contiguous local calendar days', () => {
  const data = snapshot(); const now = new Date('2026-09-28T12:00:00Z')
  data.sessionHistory = [
    { id: 'today', taskTitle: 'Fixture', phase: 'work', finishedAt: now.toISOString(), durationSeconds: 1500 },
    { id: 'yesterday', taskTitle: 'Fixture', phase: 'work', finishedAt: '2026-09-27T12:00:00Z', durationSeconds: 1200 },
    { id: 'break', taskTitle: 'Fixture', phase: 'shortBreak', finishedAt: now.toISOString(), durationSeconds: 300 },
  ]
  expect(focusAnalytics(data, now)).toEqual({ todayMinutes: 25, weekMinutes: 45, streak: 2 })
})

test('service reports failed commands and alert errors without duplicating completed phases', async () => {
  const initial = snapshot()
  initial.settings.notificationsEnabled = true
  const next: FocusSnapshot = { ...initial, activePhase: 'shortBreak', isRunning: false, phaseEndDate: undefined }
  let alerts = 0
  const service = new FocusService({ snapshot: async () => initial, timer: async () => next, notify: async () => { alerts++; throw new Error('Synthetic notification denied') } })
  await service.run(async () => initial)
  await expect(service.run(async () => { throw new Error('Synthetic helper failed') })).rejects.toThrow('Synthetic helper failed')
  expect(service.getSnapshot().error).toBe('Synthetic helper failed')
  expect(service.getSnapshot().data).toBe(initial)
  await service.tick()
  await Promise.resolve()
  expect(service.getSnapshot().error).toBe('')
  expect(service.getSnapshot().alertError).toBe('Synthetic notification denied')
  expect(service.getSnapshot().data?.activePhase).toBe('shortBreak')
  await service.tick()
  expect(alerts).toBe(1)
  service.clearAlertError()
  expect(service.getSnapshot().alertError).toBe('')
})
