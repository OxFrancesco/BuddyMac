import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SpeechClient, type SpeechNeed, type SpeechPhase } from '../src/speech'

/** Screenshots every dictation pill state with synthetic values. `bun scripts/capture-pill.ts [outDir]` */
const out = resolve(process.argv[2] ?? '/private/tmp/buddymac-pill')
await mkdir(out, { recursive: true })
const data = await mkdtemp('/private/tmp/buddymac-pill-data-')
const states: { name: string; phase: SpeechPhase; appName?: string; message?: string; needs?: SpeechNeed[]; wait?: number }[] = [
  { name: 'listening', phase: 'recording', wait: 3200 },
  { name: 'transcribing', phase: 'transcribing', appName: 'Ghostty' },
  { name: 'tidying', phase: 'formatting', appName: 'Ghostty' },
  { name: 'done', phase: 'success', appName: 'Ghostty', message: 'Inserted into Ghostty.' },
  { name: 'done-screen', phase: 'success', appName: 'Ghostty', message: 'Inserted into Ghostty.', needs: ['screenRecording'] },
  { name: 'copied', phase: 'success', appName: 'Notes', message: 'Copied. Allow Accessibility so BuddyMac can type into Notes.', needs: ['accessibility'] },
  { name: 'failed-microphone', phase: 'failed', message: 'Allow microphone access in System Settings to dictate.', needs: ['microphone'] },
]
const client = new SpeechClient({ dataDirectory: data })
try {
  for (const state of states) {
    const window = await client.previewOverlay(state)
    await Bun.sleep(state.wait ?? 900)
    const path = join(out, `pill-${state.name}.png`)
    const capture = Bun.spawn(['/usr/sbin/screencapture', '-x', '-o', '-l', String(window), path], { env: { ...process.env } })
    if (await capture.exited !== 0) throw new Error(`screencapture failed for ${state.name}`)
    console.log(path)
  }
  await client.previewOverlay({ phase: 'idle' })
} finally {
  client.dispose()
  await rm(data, { recursive: true, force: true })
}
