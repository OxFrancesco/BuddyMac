import { createAssistantMessageEventStream, fauxAssistantMessage, type Api, type Context, type Model, type MutableModels, type SimpleStreamOptions } from '@earendil-works/pi-ai'
import { DurableInference } from './durable-inference'

export function durableModels(models: MutableModels, directory: string): MutableModels {
  const engine = new DurableInference(directory, models)
  const job = (model: Model<Api>, context: Context, options?: SimpleStreamOptions & { reasoningEffort?: SimpleStreamOptions['reasoning']; serviceTier?: string }) => ({
    kind: 'chat' as const, provider: model.provider, model: model.id, context, thinking: options?.reasoning ?? options?.reasoningEffort,
    options: { maxTokens: options?.maxTokens, temperature: options?.temperature, sessionId: options?.sessionId }, codexFast: options?.serviceTier === 'priority',
  })
  const complete = async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const result = await engine.run(job(model, context, options), { signal: options?.signal })
    if (result.kind !== 'chat') throw new Error('Expected a text response.')
    return result.message
  }
  const stream = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const output = createAssistantMessageEventStream()
    const partial = { ...fauxAssistantMessage(''), provider: model.provider, model: model.id, api: model.api }
    output.push({ type: 'start', partial })
    output.push({ type: 'text_start', contentIndex: 0, partial })
    void engine.run(job(model, context, options), {
      signal: options?.signal,
      onDelta: delta => { partial.content = [{ type: 'text', text: (partial.content[0]?.type === 'text' ? partial.content[0].text : '') + delta }]; output.push({ type: 'text_delta', delta, contentIndex: 0, partial }) },
    }).then(result => {
      if (result.kind !== 'chat') throw new Error('Expected a text response.')
      output.push({ type: 'done', reason: result.message.stopReason as 'stop' | 'toolUse', message: result.message })
    }).catch(cause => {
      const error = { ...partial, stopReason: options?.signal?.aborted ? 'aborted' as const : 'error' as const, errorMessage: cause instanceof Error ? cause.message : 'Inference failed.' }
      output.push({ type: 'error', reason: error.stopReason, error })
    })
    return output
  }
  return new Proxy(models, { get(target, property) {
    if (property === 'completeSimple' || property === 'complete') return complete
    if (property === 'streamSimple' || property === 'stream') return stream
    const value = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
