import { launch } from '@gpuix/react/automation'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// Uses the real global pointer. Drive hover through computer use while this
// fixture app runs, then send commands through the printed command file.
const root = await mkdtemp('/private/tmp/buddymac-surfaces-')
const out = resolve(process.argv[2] ?? 'evidence/surfaces')
await mkdir(out, { recursive: true })
const binary = resolve(process.env.BUDDYMAC_VERIFY_APP ?? 'dist/BuddyMac.app/Contents/MacOS/BuddyMac')
const env = { ...process.env, GPUIX_BACKGROUND: '1', BUDDYMAC_VERIFY_SURFACES: '1',
  BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'),
  BUDDYMAC_LEGACY_FILES_DIR: join(root, 'no-legacy'), BUDDYMAC_TRACE_SURFACES: join(out, 'transitions.log') }
const fixture = join(root, 'Sidebar verification.txt')
await Bun.write(fixture, 'Synthetic sidebar fixture. The source file must stay intact.')
await Bun.write(join(root, 'data/Files/manifest.json'), JSON.stringify([fixture]))
await Bun.write(join(root, 'data/Files/edge.json'), JSON.stringify({ side: 'right', pinned: false, autoShow: true, holdDelay: 0.8, onlyFiles: true }))
const app = await launch({ command: binary, args: [], env })
const { pid } = await app.call('initialize', { protocolVersion: 1, client: 'BuddyMac hover verification' })
const command = join(root, 'command.json')
const results: string[] = []
const frames = join(root, 'frames')
await mkdir(frames)
let recording = true, frame = 0
const captured: { path: string; time: number }[] = []
const capture = (async () => {
  while (recording) {
    const path = join(frames, `${String(frame++).padStart(5, '0')}.png`)
    // Capture the presented AppKit window without forcing an offscreen GPUI paint.
    const list = Bun.spawn(['dist/verification/verification-pointer', 'list'], { stdout: 'pipe', stderr: 'ignore' })
    const windows = await new Response(list.stdout).json() as { pid: number; id: number }[]
    await list.exited
    const window = windows.find(window => window.pid === pid)
    if (window) {
      const screenshot = Bun.spawn(['/usr/sbin/screencapture', '-x', '-o', '-l', String(window.id), path], { stdout: 'ignore', stderr: 'ignore' })
      if (await screenshot.exited === 0) captured.push({ path, time: performance.now() })
    }
    await Bun.sleep(100)
  }
})()
console.log(JSON.stringify({ root, command, binary, out, pid }))
try {
  await app.getByTestId('nav-Files').waitFor()
  await app.screenshot({ path: join(out, 'main.png') })
  let last = ''
  for (let elapsed = 0; elapsed < 1800; elapsed++) {
    if (await Bun.file(command).exists()) {
      const text = await Bun.file(command).text()
      if (text !== last) {
        last = text
        const request: { action: string; name?: string; testId?: string } = JSON.parse(text)
        if (request.action === 'stop') break
        if (request.action === 'close') await app.call('keystrokes', { keys: 'cmd-w' })
        else if (request.action === 'click' && request.testId) await app.getByTestId(request.testId).click()
        else if (request.action === 'check' && request.name && request.testId) {
          await app.getByTestId(request.testId).waitFor({ timeoutMs: 8000 })
          if (request.name.startsWith('sidebar-')) {
            const bounds = await app.getByTestId('file-shelf').bounds()
            assert(bounds.width < 460, 'Files remained in the full window')
          }
          await app.screenshot({ path: join(out, `${request.name}.png`) })
          results.push(request.name)
          await Bun.write(join(out, 'results.json'), JSON.stringify({ binary, root, results }, null, 2))
          console.log(`PASS ${request.name}`)
        }
      }
    }
    await Bun.sleep(200)
  }
  for (const name of ['sidebar-main-open', 'notch-main-open', 'sidebar-main-closed', 'notch-main-closed']) {
    assert(results.includes(name), `Missing hover check: ${name}`)
  }
  assert(await Bun.file(fixture).exists(), 'The original file was removed')
} finally {
  recording = false
  await capture
  await app.close()
  assert(captured.length > 1, 'No native window recording was captured')
  const list = captured.map((item, index) => `file '${item.path}'\nduration ${((captured[index + 1]?.time ?? item.time + 200) - item.time) / 1000}`).join('\n')
  const timeline = join(frames, 'timeline.txt')
  await Bun.write(timeline, list + `\nfile '${captured.at(-1)?.path}'\n`)
  const video = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', timeline,
    '-vf', 'scale=1080:760:force_original_aspect_ratio=decrease,pad=1080:760:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'walkthrough.mp4')], { stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await video.exited, 0)
}
