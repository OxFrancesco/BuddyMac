import { useSyncExternalStore } from 'react'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, chmod, rename } from 'node:fs/promises'
import { createModels, type AuthPrompt, type Credential, type CredentialStore, type ImageContent } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { DurableInference } from './durable-inference'

registerBunOAuthFlows()
export type TextProvider = 'openai' | 'openai-codex' | 'openrouter'
export interface InferenceSettings { provider: TextProvider; model: string; imageModel: string; deviceId: string }
interface InferenceState {
  settings: InferenceSettings; connected: boolean; loading: boolean; login: boolean; loginUrl: string; code: string; prompt: string; error: string
  models: { id: string; name: string }[]; imageModels: { id: string; name: string }[]
}
const root = () => join(process.env.BUDDYMAC_DATA_DIR ?? join(homedir(), 'Library/Application Support/BuddyMac'), 'Inference')
const defaults: InferenceSettings = { provider: 'openrouter', model: 'gpt-6.1-sol', imageModel: 'google/gemini-3.1-flash-image', deviceId: '' }
let state: InferenceState = { settings: defaults, connected: false, loading: true, login: false, loginUrl: '', code: '', prompt: '', error: '', models: [], imageModels: [] }
const listeners = new Set<() => void>()
function update(change: Partial<InferenceState>) { state = { ...state, ...change }; for (const listener of listeners) listener() }
export function useInference() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state) }

async function privateWrite(path: string, value: unknown) {
  await mkdir(root(), { recursive: true, mode: 0o700 })
  await chmod(root(), 0o700)
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(value))
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}
async function openRouterKey(): Promise<string | undefined> {
  if (process.env.BUDDYMAC_SPEECH_DATA_DIR || process.env.BUDDYMAC_INFERENCE_MOCK === '1') return undefined
  const child = Bun.spawn(['/usr/bin/security', 'find-generic-password', '-s', 'org.buddytools.BuddyMac', '-a', 'openrouter-api-key', '-w'], { stdout: 'pipe', stderr: 'ignore', env: { ...process.env } })
  const value = (await new Response(child.stdout).text()).trim()
  return await child.exited === 0 && value ? value : undefined
}
class Credentials implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve()
  private async all(): Promise<Record<string, Credential>> {
    const path = join(root(), 'auth.json')
    if (!await Bun.file(path).exists()) return {}
    const value: unknown = await Bun.file(path).json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The inference credential store could not be read.')
    return value as Record<string, Credential>
  }
  async read(provider: string) { await this.queue; return (await this.all())[provider] }
  async list() { await this.queue; return Object.entries(await this.all()).map(([providerId, credential]) => ({ providerId, type: credential.type })) }
  async modify(provider: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const mutation = this.queue.then(async () => { const all = await this.all(); const value = await fn(all[provider]); if (value) { all[provider] = value; await privateWrite(join(root(), 'auth.json'), all) }; return value ?? all[provider] })
    this.queue = mutation.catch(() => {})
    return mutation
  }
  async delete(provider: string) {
    const mutation = this.queue.then(async () => { const all = await this.all(); delete all[provider]; await privateWrite(join(root(), 'auth.json'), all) })
    this.queue = mutation.catch(() => {})
    await mutation
  }
}
export const inferenceModels = createModels({ credentials: new Credentials(), authContext: { env: async name => name === 'OPENROUTER_API_KEY' ? openRouterKey() : undefined, fileExists: async () => false } })
inferenceModels.setProvider(openaiProvider())
inferenceModels.setProvider(openaiCodexProvider())
inferenceModels.setProvider(openrouterProvider())
if (process.env.BUDDYMAC_INFERENCE_MOCK === '1') {
  const { installInferenceFixture } = await import('./inference-fixture')
  installInferenceFixture(inferenceModels)
}
let engine: DurableInference | undefined
export const inferenceEngine = () => engine ??= new DurableInference(join(root(), 'requests'), inferenceModels)
let loaded: Promise<void> | undefined
let loginAbort: AbortController | undefined
let answer: ((value: string) => void) | undefined

export const inference = {
  get: () => state,
  async load() {
    return loaded ??= (async () => {
      const file = Bun.file(join(root(), 'settings.json'))
      if (await file.exists()) {
        const value = await file.json()
        if (!['openai', 'openai-codex', 'openrouter'].includes(value.provider) || typeof value.model !== 'string' || typeof value.imageModel !== 'string') throw new Error('Invalid inference settings.')
        update({ settings: { ...defaults, ...value } })
      }
      await this.refresh()
    })().catch(cause => { loaded = undefined; update({ loading: false, error: cause instanceof Error ? cause.message : 'Inference settings failed.' }); throw cause })
  },
  async refresh() {
    update({ connected: !!await inferenceModels.checkAuth(state.settings.provider), loading: false, models: inferenceModels.getModels(state.settings.provider).map(({ id, name }) => ({ id, name })), imageModels: inferenceModels.getModelsOfType('image', 'openrouter').map(({ id, name }) => ({ id, name })) })
  },
  async configure(change: Partial<InferenceSettings>) {
    await this.load()
    if (state.login) throw new Error('Finish or cancel sign-in before changing providers.')
    const settings = { ...state.settings, ...change }
    if (settings.provider !== 'openrouter' && !inferenceModels.getModel(settings.provider, settings.model)) throw new Error('Choose an available subscription model.')
    if (!inferenceModels.getModelOfType('image', 'openrouter', settings.imageModel)) throw new Error('Choose an available image model.')
    await privateWrite(join(root(), 'settings.json'), settings)
    update({ settings }); await this.refresh()
  },
  async connect() {
    await this.load()
    if (state.login || state.settings.provider === 'openrouter') return
    loginAbort = new AbortController()
    update({ login: true, error: '', loginUrl: '', code: '' })
    if (!state.settings.deviceId) {
      const settings = { ...state.settings, deviceId: crypto.randomUUID() }
      await privateWrite(join(root(), 'settings.json'), settings); update({ settings })
    }
    try {
      await inferenceModels.login(state.settings.provider, 'oauth', {
        signal: loginAbort.signal,
        prompt: async (prompt: AuthPrompt) => {
          if (prompt.type === 'select') return 'device_code'
          update({ prompt: prompt.message })
          return new Promise<string>((resolve, reject) => {
            const signal = prompt.signal ?? loginAbort!.signal
            const abort = () => { answer = undefined; reject(new Error('Login cancelled.')) }
            if (signal.aborted) return abort()
            signal.addEventListener('abort', abort, { once: true })
            answer = value => { signal.removeEventListener('abort', abort); answer = undefined; update({ prompt: '' }); resolve(value) }
          })
        },
        notify: event => {
          if (event.type === 'auth_url') update({ loginUrl: event.url })
          if (event.type === 'device_code') update({ loginUrl: event.verificationUri, code: event.userCode })
        },
      }, { getDeviceId: () => state.settings.deviceId })
      await this.refresh()
    } catch (cause) { if (!loginAbort.signal.aborted) update({ error: cause instanceof Error ? cause.message : 'Login failed.' }) }
    finally { loginAbort = undefined; answer = undefined; update({ login: false, loginUrl: '', prompt: '', code: '' }) }
  },
  answer(value: string) { answer?.(value) },
  cancelLogin() { loginAbort?.abort() },
  async clearRequests() { await inferenceEngine().clear() },
  async disconnect() { this.cancelLogin(); await inferenceModels.logout(state.settings.provider); await this.refresh() },
  async text(options: { system: string; input: string; model: string; screenshot?: string; signal?: AbortSignal; requestId?: string }) {
    await this.load()
    const { provider, model } = state.settings
    const selected = provider === 'openrouter' ? options.model : model
    if (provider === 'openrouter' && !inferenceModels.getModel(provider, selected)) {
      const template = inferenceModels.getModel(provider, 'openai/gpt-6.1-sol') ?? inferenceModels.getModels(provider)[0]
      if (!template) throw new Error('OpenRouter model catalog is unavailable.')
      const base = openrouterProvider()
      const chats = [...inferenceModels.getModels(provider), { ...template, id: selected, name: selected }]
      const all = [...inferenceModels.getAllModels(provider), { ...template, id: selected, name: selected }]
      inferenceModels.setProvider({ ...base, getModels: () => chats, getAllModels: () => all })
    }
    const content: (ImageContent | { type: 'text'; text: string })[] = [{ type: 'text', text: options.input }]
    if (options.screenshot) content.push({ type: 'image', data: options.screenshot, mimeType: 'image/jpeg' })
    const result = await inferenceEngine().run({ kind: 'chat', provider, model: selected, thinking: 'low', context: { systemPrompt: options.system, messages: [{ role: 'user', content, timestamp: Date.now() }] } }, options)
    if (result.kind !== 'chat' || result.message.stopReason !== 'stop') throw new Error('The model did not return a complete text response.')
    const text = result.message.content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
    if (!text) throw new Error('The model returned no text.')
    return text
  },
}
