import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SpeechClient } from '../src/speech'

const root = await mkdtemp('/private/tmp/buddymac-model-defaults-')
const model = '~openai/gpt-luna-latest'
const helper = resolve('native/speech/build/buddymac-speech')
const checks: string[] = []
async function inspect(directory: string, cleanup: string, writing: string) {
  const client = new SpeechClient({ dataDirectory: directory, binaryPath: helper })
  try {
    assert.equal((await client.preferences()).cleanupModel, cleanup)
    assert.equal((await client.status()).writeModel, writing)
    const state = await client.writing()
    assert.equal(state.settings.rewriteProvider.modelID, writing)
    return { preferences: await client.preferences(), state }
  } finally { client.dispose() }
}
const fresh = join(root, 'fresh')
const defaults = await inspect(fresh, model, model)
checks.push('Fresh settings use GPT Luna for cleanup and rewriting')
const upgrade = join(root, 'upgrade'); await mkdir(upgrade)
await Bun.write(join(upgrade, 'settings.json'), JSON.stringify({ preferences: { ...defaults.preferences, cleanupModel: 'google/gemini-2.5-flash-lite' }, history: [] }))
await Bun.write(join(upgrade, 'writing.json'), JSON.stringify({ ...defaults.state, settings: { ...defaults.state.settings, rewriteProvider: { kind: 'openRouter', modelID: 'google/gemini-3.1-flash-lite' } } }))
await inspect(upgrade, model, model)
checks.push('Existing built-in Gemini defaults migrate to GPT Luna')
const selected = new SpeechClient({ dataDirectory: upgrade, binaryPath: helper })
try {
  await selected.savePreferences({ ...await selected.preferences(), cleanupModel: 'google/gemini-2.5-flash-lite' })
  await selected.setWriteProvider({ kind: 'openRouter', modelID: 'google/gemini-3.1-flash-lite' })
} finally { selected.dispose() }
await inspect(upgrade, 'google/gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite')
checks.push('A later explicit model choice survives restart')
const custom = join(root, 'custom'); await mkdir(custom)
await Bun.write(join(custom, 'settings.json'), JSON.stringify({ preferences: { ...defaults.preferences, cleanupModel: 'custom/model' }, history: [] }))
await Bun.write(join(custom, 'writing.json'), JSON.stringify({ ...defaults.state, settings: { ...defaults.state.settings, rewriteProvider: { kind: 'openRouter', modelID: 'custom/model' } } }))
await inspect(custom, 'custom/model', 'custom/model')
checks.push('Existing custom choices survive migration')
await mkdir('evidence/models-fn', { recursive: true })
await Bun.write('evidence/models-fn/defaults.json', JSON.stringify({ root, model, checks }, null, 2))
console.log(JSON.stringify({ passed: checks.length, checks }))
