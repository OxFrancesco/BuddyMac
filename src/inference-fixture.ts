import { appendFileSync } from 'node:fs'
import { fauxAssistantMessage, fauxProvider, type MutableModels } from '@earendil-works/pi-ai'

export function installInferenceFixture(models: MutableModels) {
  for (const id of ['openai', 'openai-codex', 'openrouter']) {
    const base = models.getProvider(id)!
    const imageModels = models.getModelsOfType('image', id)
    const faux = fauxProvider({ models: base.getModels().map(model => ({ id: model.id, name: model.name, input: model.input, contextWindow: model.contextWindow })), tokensPerSecond: 200 })
    faux.setResponses(Array.from({ length: 100 }, () => context => {
      const last = [...context.messages].reverse().find(message => message.role === 'user')
      const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
      return fauxAssistantMessage(`Fixture rewrite: ${text}`)
    }))
    const chats = faux.provider.getModels().map(model => ({ ...model, provider: id }))
    models.setProvider({ ...faux.provider, id, getModels: () => chats, getAllModels: () => [...chats, ...imageModels],
      generateImages: async (model, context) => {
        const prompt = context.input.flatMap(item => item.type === 'text' ? [item.text] : []).join(' ')
        // Optional pacing for Dock batch checks: each request waits, logs when it ran, and can fail by app name.
        const log = process.env.BUDDYMAC_INFERENCE_FIXTURE_LOG, started = Date.now()
        await Bun.sleep(Number(process.env.BUDDYMAC_INFERENCE_FIXTURE_DELAY_MS ?? 0))
        if (log) appendFileSync(log, JSON.stringify({ prompt, started, ended: Date.now() }) + '\n')
        const failing = process.env.BUDDYMAC_INFERENCE_FIXTURE_FAIL
        if (failing && prompt.includes(failing)) return { api: model.api, provider: id, model: model.id, stopReason: 'error', errorMessage: 'Fixture provider refused this icon.', timestamp: Date.now(), output: [] }
        return { api: model.api, provider: id, model: model.id, stopReason: 'stop', timestamp: Date.now(), output: [{ type: 'image', mimeType: 'image/png', data: Buffer.from(await Bun.file(process.env.BUDDYMAC_INFERENCE_FIXTURE_IMAGE!).arrayBuffer()).toString('base64') }] }
      },
    })
  }
}
