import { focus, focusClient, type FocusSnapshot } from './focus'

export const phaseTitle = (phase: FocusSnapshot['activePhase']) => phase === 'work' ? 'Focus' : phase === 'longBreak' ? 'Long Break' : 'Short Break'
export interface FocusState { data: FocusSnapshot | null; error: string; alertError: string }
type FocusEngine = Pick<typeof focus, 'snapshot' | 'timer' | 'notify'> & { onChange?: (listener: () => void) => () => void }
export class FocusService {
  private state: FocusState = { data: null, error: '', alertError: '' }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private chain: Promise<void> = Promise.resolve()
  private ticking = false
  constructor(private engine: FocusEngine = { ...focus, onChange: listener => focusClient.onChange(listener) }, private interval = 1_000, private now = Date.now) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(state: FocusState) { this.state = state; for (const listener of this.listeners) listener() }
  private unsubscribe: (() => void) | null = null
  refresh() { return this.run(() => this.engine.snapshot()).catch(() => this.state.data!) }
  start() {
    if (this.timer) return
    this.unsubscribe = this.engine.onChange?.(() => { void this.refresh() }) ?? null
    this.timer = setInterval(() => { void this.tick() }, this.interval)
    void this.run(() => this.engine.snapshot()).then(() => this.tick()).catch(() => {})
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.unsubscribe?.(); this.unsubscribe = null }
  clearAlertError() { this.publish({ ...this.state, alertError: '' }) }
  run(work: () => Promise<FocusSnapshot>): Promise<FocusSnapshot> {
    const result = this.chain.then(async () => {
      try {
        const next = await work(); const previous = this.state.data
        this.publish({ ...this.state, data: next, error: '' })
        if (previous && previous.activePhase !== next.activePhase && (next.settings.notificationsEnabled || next.settings.playSoundOnTransitions)) {
          const title = `${phaseTitle(previous.activePhase)} finished`
          const task = next.tasks.find(item => item.id === next.selectedTaskID)?.title
          const message = task ? `Next up: ${phaseTitle(next.activePhase).toLowerCase()} for ${task}.` : `Next up: ${phaseTitle(next.activePhase).toLowerCase()}.`
          void this.engine.notify(title, message, next.settings).catch(error => this.publish({ ...this.state, alertError: error instanceof Error ? error.message : 'Timer alert failed.' }))
        }
        return next
      } catch (error) { this.publish({ ...this.state, error: error instanceof Error ? error.message : String(error) }); throw error }
    })
    this.chain = result.then(() => {}, () => {})
    return result
  }
  async tick() {
    if (this.ticking || !this.state.data?.isRunning) return
    if (this.updateCountdown(this.state.data)) return
    this.ticking = true
    try {
      await this.run(async () => {
        const current = this.state.data!
        if (!current.isRunning || this.updateCountdown(current)) return this.state.data!
        return this.engine.timer('tick')
      })
    } catch {} finally { this.ticking = false }
  }
  private updateCountdown(snapshot: FocusSnapshot): boolean {
    const deadline = snapshot.phaseEndDate ? Date.parse(snapshot.phaseEndDate) : NaN
    if (!Number.isFinite(deadline)) return false
    const remaining = deadline - this.now()
    const remainingSeconds = Math.max(0, Math.ceil(remaining / 1_000))
    if (remainingSeconds !== snapshot.remainingSeconds) {
      this.publish({ ...this.state, data: { ...snapshot, remainingSeconds } })
    }
    return remaining > 0
  }
}
export const focusService = new FocusService()
export const startFocusService = () => focusService.start()
export const stopFocusService = () => focusService.stop()

export function focusAnalytics(snapshot: FocusSnapshot, now = new Date()) {
  const day = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const today = day(now); const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0)
  const work = snapshot.sessionHistory.filter(session => session.phase === 'work')
  const todaySessions = work.filter(session => day(new Date(session.finishedAt)) === today)
  const week = work.filter(session => new Date(session.finishedAt) >= weekStart && new Date(session.finishedAt) <= now)
  const days = new Set(work.map(session => day(new Date(session.finishedAt))))
  const cursor = new Date(now); cursor.setHours(12, 0, 0, 0)
  if (!days.has(day(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(day(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1) }
  return { todayMinutes: Math.floor(todaySessions.reduce((sum, item) => sum + item.durationSeconds, 0) / 60), weekMinutes: Math.floor(week.reduce((sum, item) => sum + item.durationSeconds, 0) / 60), streak }
}
