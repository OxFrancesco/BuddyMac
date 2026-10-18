import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { eventSchema, frameSchema, sessionsSchema, snapshotSchema, sourcesSchema, stateSchema, type LinyEvent, type LinyProvider, type LinyThinking } from '../native/liny/agent/src/buddymac-contract'
export type { LinyState, LinySnapshot, LinySessions, LinySources, LinyEvent, LinyProvider, LinyThinking } from '../native/liny/agent/src/buddymac-contract'

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
/** The worker is a second Bun runtime. It exits after this long without requests and comes back on the next one. */
const idleSeconds = () => Number(process.env.BUDDYMAC_LINY_IDLE_SECONDS) || 600
export class LinyClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private pending = new Map<number, Pending>()
  private listeners = new Set<(event: LinyEvent) => void>()
  private buffer = ''
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private retiring: Promise<void> | null = null
  constructor(private options: { command?: [string, ...string[]]; env?: NodeJS.ProcessEnv; idleSeconds?: number } = {}) {}
  onEvent(listener: (event: LinyEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  get running() { return this.child !== null }
  /** Starts the worker ahead of a likely request, so a relaunch after idling overlaps the user's typing. */
  warm() { if (this.child || this.retiring) return; this.start(); this.armIdle() }
  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (!this.child || this.pending.size) return
    this.idleTimer = setTimeout(() => this.retire(), (this.options.idleSeconds ?? idleSeconds()) * 1000)
    this.idleTimer.unref()
  }
  /** Asks the worker to exit. It refuses while it still has a turn, sign-in, compaction or dream run going; requests made meanwhile wait for the answer. */
  private retire() {
    this.idleTimer = null
    const child = this.child
    if (!child || this.pending.size || this.retiring) return
    const id = ++this.sequence
    this.retiring = new Promise<void>(resolve => {
      const finish = (keep: boolean) => { this.retiring = null; resolve(); if (keep) this.armIdle() }
      const timer = setTimeout(() => { this.pending.delete(id); finish(true) }, 5_000)
      this.pending.set(id, {
        resolve: value => {
          if (!(typeof value === 'object' && value !== null && 'retired' in value && value.retired === true)) return finish(true)
          if (this.child !== child) return finish(false)
          const kill = setTimeout(() => child.kill('SIGKILL'), 5_000)
          child.once('close', () => { clearTimeout(kill); finish(false) })
        },
        reject: () => finish(this.child === child),
        timer,
      })
      child.stdin.write(`${JSON.stringify({ type: 'req', id, method: 'worker.retire' })}\n`)
    })
  }
  private start() {
    if (this.child) return
    const command: [string, ...string[]] = this.options.command ?? (process.env.BUDDYMAC_LINY_HELPER
      ? [process.env.BUDDYMAC_LINY_HELPER]
      : process.execPath.includes('.app/Contents/MacOS/')
        ? [process.execPath, '--liny-worker']
        : [resolve(import.meta.dir, '../dist/buddymac-liny')])
    const [executable, ...args] = command
    const child = spawn(executable, args, { stdio: 'pipe', env: { ...process.env, ...this.options.env } })
    this.child = child; this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return
      this.buffer += chunk
      for (;;) {
        const newline = this.buffer.indexOf('\n'); if (newline < 0) break
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1)
        if (line.trim()) this.receive(line)
      }
    })
    child.stderr.resume()
    child.on('error', error => this.failed(child, error))
    child.on('close', code => this.failed(child, new Error(`Liny service stopped (${code ?? 'signal'}).`)))
  }
  private failed(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child) return
    this.child = null
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
  }
  private receive(line: string) {
    try {
      const frame = frameSchema.parse(JSON.parse(line))
      if (frame.type === 'event') {
        const event = eventSchema.parse(frame)
        for (const listener of this.listeners) listener(event)
        return
      }
      const pending = this.pending.get(frame.id); if (!pending) return
      this.pending.delete(frame.id); clearTimeout(pending.timer)
      if (frame.ok) pending.resolve(frame.payload); else pending.reject(new Error(frame.error))
    } catch { this.listeners.forEach(listener => listener({ event: 'turn.error', message: 'The Liny service returned an invalid response.' })) }
  }
  private async request(method: string, params?: unknown, timeout = 30_000): Promise<unknown> {
    // A retiring worker drops later lines, so wait to learn whether it stays or a fresh one is needed.
    while (this.retiring) await this.retiring
    this.start()
    const child = this.child
    if (!child) throw new Error('Liny service did not start.')
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const id = ++this.sequence
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Liny request timed out.')) }, timeout)
        this.pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ type: 'req', id, method, ...(params === undefined ? {} : { params }) })}\n`)
      })
    } finally { this.armIdle() }
  }
  async state() { return stateSchema.parse(await this.request('state.get')) }
  async snapshot() { return snapshotSchema.parse(await this.request('session.snapshot')) }
  async sessions() { return sessionsSchema.parse(await this.request('session.list')) }
  async importSources() { return sourcesSchema.parse(await this.request('import.sources')) }
  async importSource(id: string, includeCredentials = false) { await this.request('import.profile', { id, includeCredentials }); return this.snapshot() }
  async send(text: string, images: { data: string; mimeType: string }[] = [], options: { tools?: 'computer' | 'none' } = {}) { await this.request('chat.send', { text, images, ...options }, 30 * 60_000) }
  async abort() { await this.request('chat.abort') }
  async reset() { await this.request('session.reset'); return this.snapshot() }
  async resume(id: string) { await this.request('session.resume', { id }); return this.snapshot() }
  async configure(selection: { provider: LinyProvider; model: string }, thinking?: LinyThinking) { await this.request('config.set', { selection, thinking }); return this.state() }
  async login(provider: LinyProvider, auth: { method: 'oauth'; mode: 'device' | 'browser' } | { method: 'api_key'; key: string }) { await this.request('auth.login', { provider, ...auth }, 15 * 60_000); return this.state() }
  async logout(provider: LinyProvider) { await this.request('auth.logout', { provider }); return this.state() }
  close() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const child = this.child
    if (!child) return
    child.stdin.end(); child.kill('SIGTERM')
    this.failed(child, new Error('Liny service closed.'))
  }
}
export const liny = new LinyClient()
