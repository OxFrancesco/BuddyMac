import assert from 'node:assert/strict'
import { launch } from '@gpuix/react/automation'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SpeechClient } from '../src/speech'

const root = await mkdtemp('/private/tmp/buddymac-models-fn-ui-')
const env = { ...process.env, GPUIX_BACKGROUND: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_LINY_HOME: join(root, 'liny') }
const client = new SpeechClient({ dataDirectory: env.BUDDYMAC_SPEECH_DATA_DIR })
try {
 const prefs = await client.preferences()
 assert.equal(prefs.cleanupModel, '~openai/gpt-luna-latest')
 await client.savePreferences({ ...prefs, shortcuts: { ...prefs.shortcuts, hold: { keyCode: 63, modifiers: 0, keyLabel: 'Fn' } } })
} finally { client.dispose() }
const app = await launch({ command: process.env.BUDDYMAC_VERIFY_APP ?? process.execPath, args: process.env.BUDDYMAC_VERIFY_APP ? [] : ['src/app.tsx'], env })
const out = resolve('evidence/models-fn'); await mkdir(out, { recursive: true })
try {
 await app.getByTestId('nav-Talk').click()
 await app.getByTestId('talk-tab-settings').click()
 await app.getByTestId('talk-cleanup-model').waitFor()
 await Bun.sleep(700); await app.screenshot({ path: join(out, 'cleanup-model.png') })
 await app.getByTestId('talk-tab-shortcuts').click()
 await app.getByTestId('talk-shortcut-hold').getByText('Fn').waitFor()
 await app.getByTestId('talk-fn-keyboard-settings').waitFor()
 await Bun.sleep(700); await app.screenshot({ path: join(out, 'fn-shortcuts.png') })
 await app.getByTestId('nav-Write').click()
 await app.getByTestId('write-tab-settings').click()
 await app.getByTestId('write-model').waitFor()
 const text = await app.call('getPaintedText', {})
 assert(text.text.some(line => line.includes('~openai/gpt-luna-latest')))
 await Bun.sleep(700); await app.screenshot({ path: join(out, 'write-model.png') })
 await Bun.write(join(out, 'ui.json'), JSON.stringify({ root, checks: ['Luna cleanup default shown', 'Saved Fn shortcut and Keyboard settings action shown', 'Luna writing default shown'], limits: ['Fn hardware press and microphone capture require manual verification; AppKit Fn press/release is checked separately.'] }, null, 2))
} finally { await app.close() }
