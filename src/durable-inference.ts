import { mkdir, readFile, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import type { AssistantMessage, Context, ImageContent, Models, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { Harness, createRegistry, defineDoc, defineExtension, defineTask, type TaskId } from '@earendil-works/pi-durable'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'

export type InferenceJob =
  | { kind: 'chat'; provider: string; model: string; context: Context; thinking?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; options?: Pick<SimpleStreamOptions, 'maxTokens' | 'temperature' | 'sessionId'>; codexFast?: boolean }
  | { kind: 'image'; provider: string; model: string; prompt: string; reference?: ImageContent }
export type InferenceResult = { kind: 'chat'; message: AssistantMessage } | { kind: 'image'; image: ImageContent }

const Jobs = defineDoc<{ jobs: Record<string, { id: number; hash: string }> }>({ kind: 'buddymac.inference.jobs', version: 1, scope: 'session', initial: () => ({ jobs: {} }) })
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Inference failed.'

export class DurableInference {
  private opened?: Promise<Harness>
  private active = 0
  private clearing = false
  private readonly deltas = new Map<number, (text: string) => void>()
  private readonly lock: string
  private readonly task
  constructor(private readonly directory: string, readonly models: Models) {
    this.lock = join(directory, 'owner.lock')
    this.task = defineTask<InferenceJob, { phase: 'run' | 'sent' }, InferenceResult>({
      name: 'buddymac.inference', version: 1, initial: () => ({ phase: 'run' }),
      phases: {
        run: async (task, runtime, context) => {
          const input = task.input
          try {
            let result: InferenceResult
            if (input.kind === 'chat') {
              const model = models.getModel(input.provider, input.model)
              if (!model) throw new Error(`Model unavailable: ${input.provider}/${input.model}`)
              if (input.context.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'image')) && !model.input.includes('image')) throw new Error('Choose a model that accepts images to use screen context.')
              const options = { ...input.options, signal: runtime.signal, maxRetries: 0 }
              const stream = model.api === 'openai-codex-responses' && input.codexFast
                ? models.stream(model as import('@earendil-works/pi-ai').Model<'openai-codex-responses'>, input.context, { ...options, reasoningEffort: input.thinking ?? 'low', serviceTier: 'priority', textVerbosity: 'low' })
                : models.streamSimple(model, input.context, { ...options, reasoning: input.thinking })
              for await (const event of stream) if (event.type === 'text_delta') this.deltas.get(task.id)?.(event.delta)
              const message = await stream.result()
              if (message.stopReason === 'error' || message.stopReason === 'aborted' || message.stopReason === 'length') throw new Error(message.errorMessage || `Inference ended with ${message.stopReason}.`)
              result = { kind: 'chat', message }
            } else {
              await runtime.commit(() => ({ status: 'running', checkpoint: { phase: 'sent' } }), context)
              const model = models.getModelOfType('image', input.provider, input.model)
              if (!model) throw new Error('Choose an available image model.')
              const output = await models.generateImages(model, { input: [{ type: 'text', text: input.prompt }, ...(input.reference && model.input.includes('image') ? [input.reference] : [])] }, { signal: runtime.signal })
              if (output.stopReason === 'error') throw new Error(output.errorMessage || 'Image generation failed.')
              const image = output.output.find((block): block is ImageContent => block.type === 'image')
              if (!image) throw new Error('The model returned no image.')
              result = { kind: 'image', image }
            }
            await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), context)
          } catch (cause) {
            if (runtime.signal.aborted) throw cause
            await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed', error: { message: errorText(cause) } } }), context)
          }
        },
        sent: async (_task, runtime, context) => {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed', error: { message: 'The app stopped while this request was with the provider. It was not sent again. Start a new request to retry.' } } }), context)
        },
      },
      abort: async (_task, runtime, context) => { await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context) },
    })
  }

  private open(): Promise<Harness> {
    return this.opened ??= (async () => {
      process.umask(0o077)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await chmod(this.directory, 0o700)
      try { await mkdir(this.lock, { mode: 0o700 }) }
      catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause
        const pid = Number(await readFile(join(this.lock, 'pid'), 'utf8').catch(() => '0'))
        if (!pid) throw new Error('Another app is opening this inference store. Try again.')
        try { process.kill(pid, 0); throw new Error('This inference store is already open in another BuddyMac process.') }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error }
        await rm(this.lock, { recursive: true })
        await mkdir(this.lock, { mode: 0o700 })
      }
      await Bun.write(join(this.lock, 'pid'), String(process.pid))
      const registry = createRegistry()
      registry.install(defineExtension({ name: 'buddymac', tasks: [this.task] }))
      try {
        const storage = await openNodeJsonlStorage(join(this.directory, 'journal'), BACKGROUND_CONTEXT, { fsync: true })
        const harness = await Harness.open(storage, { models: this.models, registry }, BACKGROUND_CONTEXT)
        harness.resume()
        return harness
      } catch (cause) { await rm(this.lock, { recursive: true, force: true }); throw cause }
    })().catch(cause => { this.opened = undefined; throw cause })
  }

  async run(job: InferenceJob, options: { requestId?: string; signal?: AbortSignal; onDelta?: (text: string) => void } = {}): Promise<InferenceResult> {
    options.signal?.throwIfAborted()
    if (this.clearing) throw new Error('Saved requests are being cleared. Try again shortly.')
    this.active++
    try { return await this.execute(job, options) }
    finally { this.active-- }
  }

  private async execute(job: InferenceJob, options: { requestId?: string; signal?: AbortSignal; onDelta?: (text: string) => void }): Promise<InferenceResult> {
    const harness = await this.open()
    const root = await harness.root(BACKGROUND_CONTEXT)
    const requestId = options.requestId ?? crypto.randomUUID()
    const hash = createHash('sha256').update(JSON.stringify(job)).digest('hex')
    const id = await harness.commit(async tx => {
      const doc = await tx.doc(Jobs)
      const previous = doc.jobs[requestId]
      if (previous) {
        if (previous.hash !== hash) throw new Error('This request ID already belongs to different input.')
        return previous.id as TaskId<InferenceResult>
      }
      const id = await tx.createTask(this.task, job, { conversationId: root.id, ownership: { kind: 'conversation' } })
      doc.jobs[requestId] = { id, hash }
      return id
    }, BACKGROUND_CONTEXT)
    if (options.onDelta) this.deltas.set(id, options.onDelta)
    let cancellation: Promise<unknown> | undefined
    const abort = () => { cancellation ??= harness.abortTask(id, BACKGROUND_CONTEXT); void cancellation.catch(() => {}) }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    try {
      const receipt = await harness.waitForTask(id, options.signal ? withAbortSignal(options.signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT)
      const outcome = receipt.state.outcome
      if (outcome.status !== 'completed') throw new Error(outcome.error ? outcome.error.message : 'Inference cancelled.')
      return outcome.result
    } finally { options.signal?.removeEventListener('abort', abort); this.deltas.delete(id); if (cancellation) await cancellation }
  }

  async close() {
    if (!this.opened) return
    const harness = await this.opened
    await harness.close(BACKGROUND_CONTEXT)
    await rm(this.lock, { recursive: true, force: true })
    this.opened = undefined
  }

  async clear() {
    if (this.active || this.clearing) throw new Error('Finish or cancel the current requests before clearing them.')
    this.clearing = true
    try {
      const harness = await this.open()
      if ((await harness.inspect(BACKGROUND_CONTEXT)).tasks.length) throw new Error('Finish or cancel the current requests before clearing them.')
      await harness.close(BACKGROUND_CONTEXT)
      this.opened = undefined
      try { await rm(join(this.directory, 'journal'), { recursive: true, force: true }) }
      finally { await rm(this.lock, { recursive: true, force: true }) }
    } finally { this.clearing = false }
  }
}
