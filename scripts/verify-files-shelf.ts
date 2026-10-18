import { launch } from '@gpuix/react/automation'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// Bulk selection, keyboard removal and the pinned edge shelf, against isolated fixture stores.
// The pinned steps show the real shelf at the right edge of the display for a moment.
const root = await mkdtemp('/private/tmp/buddymac-files-shelf-')
const out = resolve(process.argv[2] ?? 'evidence/files-shelf')
await mkdir(out, { recursive: true })
const env = { ...process.env, GPUIX_BACKGROUND: '1', BUDDYMAC_VERIFY_SURFACES: '1',
  BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'),
  BUDDYMAC_LEGACY_FILES_DIR: join(root, 'no-legacy'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'no-pack.json'),
  BUDDYMAC_TRACE_SURFACES: join(out, 'transitions.log') }
const fixtures = Array.from({ length: 8 }, (_, index) => join(root, `Shelf fixture ${index + 1}.txt`))
for (const path of fixtures) await Bun.write(path, `Fixture ${path}. Must stay on disk.`)
const manifest = join(root, 'data/Files/manifest.json')
const shelved = async () => (await Bun.file(manifest).json() as string[]).length
async function shelve(paths: string[]) {
  const child = Bun.spawn([resolve('dist/native/buddymac-files')], { env, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' })
  child.stdin.write(JSON.stringify({ action: 'add', paths })); child.stdin.end()
  assert.equal(await child.exited, 0)
}
async function until(check: () => Promise<boolean>, what: string, timeoutMs = 8000) {
  for (const start = Date.now(); Date.now() - start < timeoutMs; await Bun.sleep(100)) if (await check()) return
  throw new Error(`Timed out: ${what}`)
}
await shelve(fixtures)

const packaged = process.env.BUDDYMAC_VERIFY_APP
const app = await launch({ command: packaged ?? process.execPath, args: packaged ? [] : ['src/app.tsx'], env })
const press = (keys: string) => app.call('keystrokes', { keys })
const present = (testId: string) => app.getByTestId(testId).bounds().then(() => true, () => false)
const steps: string[] = []
const frames = await mkdtemp('/private/tmp/buddymac-files-frames-')
let recording = true
const captured: { path: string; time: number }[] = []
const capture = (async () => { while (recording) { const path = join(frames, `${String(captured.length).padStart(5, '0')}.png`); await app.screenshot({ path }).then(() => captured.push({ path, time: performance.now() }), () => {}); await Bun.sleep(200) } })()
try {
  await app.getByTestId('file-Shelf fixture 8.txt').waitFor({ timeoutMs: 20000 })
  assert(!await present('files-remove'), 'Nothing should start selected')

  await press('cmd-a')
  await app.getByTestId('files-remove').waitFor({ timeoutMs: 4000 })
  await app.screenshot({ path: join(out, 'select-all.png') })
  await press('backspace')
  await app.getByText('Drop files here, paste them, or choose Add files.').waitFor({ timeoutMs: 8000 })
  assert.equal(await shelved(), 0)
  steps.push('Cmd+A with nothing focused selects every file and Backspace removes them all')

  await shelve(fixtures)
  await app.getByTestId('file-Shelf fixture 8.txt').waitFor({ timeoutMs: 8000 })
  steps.push('Shelf picks up a change made by another process')
  await app.getByTestId('files-search').fill('fixture')
  await press('cmd-a')
  await Bun.sleep(300)
  assert(!await present('files-remove'), 'Cmd+A in the search field must select its text, not files')
  await app.getByTestId('files-search').fill('fixture 1')
  await app.getByTestId('file-Shelf fixture 1.txt').click()
  await app.getByTestId('files-remove').waitFor()
  await app.getByTestId('files-search').fill('')
  steps.push('Cmd+A inside search leaves files alone')

  await app.getByTestId('file-Shelf fixture 3.txt').click({ modifiers: 'shift' })
  await app.screenshot({ path: join(out, 'shift-range.png') })
  await app.getByTestId('files-remove').click()
  await until(async () => await shelved() === 5, 'shift range removal')
  await until(async () => !await present('file-Shelf fixture 3.txt'), 'list settles after removal')
  await app.getByTestId('file-Shelf fixture 4.txt').click()
  await app.getByTestId('file-Shelf fixture 6.txt').click({ modifiers: 'cmd' })
  await press('delete')
  await until(async () => await shelved() === 3, 'cmd-click removal with Delete')
  await until(async () => !await present('file-Shelf fixture 6.txt'), 'list settles after Delete')
  await app.getByTestId('file-Shelf fixture 7.txt').click()
  await press('escape')
  await until(async () => !await present('files-remove'), 'Escape clears the selection')
  steps.push('Shift-click range, Cmd-click and Delete, Escape clears selection')

  await app.getByTestId('files-tab-settings').click()
  // Choosing an edge previews the shelf there. Unpinned, it hides again because the pointer is elsewhere.
  await app.getByTestId('files-edge-right').click()
  await until(async () => !await present('nav-Files'), 'shelf preview on the right edge')
  await app.getByTestId('nav-Files').waitFor({ timeoutMs: 8000 })
  steps.push('Unpinned shelf hides on its own when the pointer is away')
  await app.getByTestId('files-tab-settings').click()
  await app.getByTestId('files-edge-pin').click()
  await Bun.sleep(1000)
  assert(await present('nav-Files'), 'Pinning must not pull the main window into the shelf')
  await app.getByTestId('files-edge-left').click()
  await app.getByTestId('files-hide').waitFor({ timeoutMs: 8000 })
  await Bun.sleep(1200)
  assert(await present('files-hide'), 'Pinned shelf must stay open when the pointer is away')
  await app.screenshot({ path: join(out, 'pinned-shelf.png') })
  await app.getByTestId('files-hide').click()
  await app.getByTestId('nav-Files').waitFor({ timeoutMs: 8000 })
  await Bun.sleep(1500)
  assert(await present('nav-Files') && !await present('files-hide'), 'Main window must stay after hiding a pinned shelf')
  await app.screenshot({ path: join(out, 'after-hide.png') })
  steps.push('Pinned shelf stays open, Hide closes it, and the main window does not bounce back to the shelf')

  for (const path of fixtures) assert(await Bun.file(path).exists(), `Original removed: ${path}`)
  steps.push('Every original file is still on disk')
  await Bun.write(join(out, 'results.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), executable: packaged ?? 'development', steps }, null, 2))
  console.log(JSON.stringify({ passed: steps.length, steps }))
} catch (error) { console.error('Completed steps:', steps); await app.screenshot({ path: join(out, 'failure.png') }).catch(() => {}); throw error }
finally {
  recording = false; await capture; await app.close()
  if (captured.length > 1) {
    const list = captured.map((frame, index) => `file '${frame.path}'\nduration ${((captured[index + 1]?.time ?? frame.time + 400) - frame.time) / 1000}`).join('\n')
    await Bun.write(join(frames, 'frames.txt'), `${list}\nfile '${captured.at(-1)!.path}'\n`)
    const video = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'frames.txt'),
      '-vf', 'scale=1080:760:force_original_aspect_ratio=decrease,pad=1080:760:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'walkthrough.mp4')], { stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await video.exited, 0)
  }
}
