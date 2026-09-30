import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { eventSchema, frameSchema, sessionsSchema, snapshotSchema, sourcesSchema, stateSchema, type LinyEvent, type LinyProvider, type LinyThinking } from '../native/liny/agent/src/buddymac-contract'
export type { LinyState, LinySnapshot, LinySessions, LinySources, LinyEvent, LinyProvider, LinyThinking } from '../native/liny/agent/src/buddymac-contract'

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export class LinyClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private pending = new Map<number, Pending>()
  private listeners = new Set<(event: LinyEvent) => void>()
  private buffer = ''
  constructor(private options: { executable?: string; env?: NodeJS.ProcessEnv } = {}) {}
  onEvent(listener: (event: LinyEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private start() {
    if (this.child) return
    const executable = this.options.executable ?? process.env.BUDDYMAC_LINY_HELPER ?? (process.execPath.includes('.app/Contents/MacOS/') ? resolve(dirname(process.execPath), 'buddymac-liny') : resolve(import.meta.dir, '../dist/buddymac-liny'))
    const child = spawn(executable, [], { stdio: 'pipe', env: { ...process.env, ...this.options.env } })
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
  private request(method: string, params?: unknown, timeout = 30_000): Promise<unknown> {
    this.start()
    const child = this.child
    if (!child) return Promise.reject(new Error('Liny service did not start.'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Liny request timed out.')) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ type: 'req', id, method, ...(params === undefined ? {} : { params }) })}\n`)
    })
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
    const child = this.child
    if (!child) return
    child.stdin.end(); child.kill('SIGTERM')
    this.failed(child, new Error('Liny service closed.'))
  }
}
export const liny = new LinyClient()
