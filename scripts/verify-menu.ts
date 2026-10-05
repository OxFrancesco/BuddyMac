import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { launch } from '@gpuix/react/automation'

const root = await mkdtemp('/private/tmp/buddymac-menu-')
const out = resolve(process.argv[2] ?? 'evidence/menu')
await mkdir(out, { recursive: true })
const binary = resolve(process.env.BUDDYMAC_VERIFY_APP ?? 'dist/BuddyMac.app/Contents/MacOS/BuddyMac')
const env = { ...process.env, GPUIX_BACKGROUND: '0', LINY_MOCK: '1', BUDDYMAC_INFERENCE_MOCK: '1',
  BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'),
  BUDDYMAC_LINY_SOURCE_HOME: join(root, 'original'), BUDDYMAC_LEGACY_FILES_DIR: join(root, 'no-legacy') }
async function run(args: string[]) {
  const child = Bun.spawn(args, { env, stdout: 'pipe', stderr: 'pipe' })
  const [text, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  assert.equal(code, 0, error || text)
  return text.trim()
}
const helper = join(root, 'menu')
await run(['swiftc', '-module-cache-path', '/private/tmp/buddymac-swift-module-cache', resolve('native/verification/Menu.swift'), '-o', helper, '-framework', 'AppKit', '-framework', 'ApplicationServices'])
const app = await launch({ command: binary, args: [], env })
const { pid } = await app.call('initialize', { protocolVersion: 1, client: 'BuddyMac menu verification' })
const state = async () => JSON.parse(await run([helper, String(pid), 'state'])) as { policy: number; terminated: boolean }
const visible = async () => (JSON.parse(await run([resolve('dist/verification/verification-pointer'), 'list'])) as { pid: number }[]).some(window => window.pid === pid)
async function waitVisible(expected: boolean) {
  const deadline = Date.now() + 5000
  while (await visible() !== expected && Date.now() < deadline) await Bun.sleep(100)
  assert.equal(await visible(), expected)
}
const checks: string[] = []
const frames = join(root, 'frames')
await mkdir(frames)
let recording = true
const captured: { path: string; time: number }[] = []
const capture = (async () => {
  while (recording) {
    const path = join(frames, `${String(captured.length).padStart(5, '0')}.png`)
    await app.screenshot({ path })
    captured.push({ path, time: performance.now() })
    await Bun.sleep(250)
  }
})()
try {
  await Bun.sleep(800)
  assert.equal((await state()).policy, 1)
  assert.equal(await visible(), false)
  checks.push('Normal launch is an accessory app with no visible window')
  await run([helper, String(pid), 'Settings'])
  await app.getByTestId('settings-tab-general').waitFor({ timeoutMs: 10000 })
  await waitVisible(true)
  assert.equal((await state()).policy, 1)
  await app.screenshot({ path: join(out, 'menu-settings.png') })
  checks.push('Settings opens through its native status-menu action without changing accessory policy')
  await run([helper, String(pid), 'close'])
  await Bun.sleep(300)
  assert.equal(await visible(), false)
  assert.equal((await state()).terminated, false)
  checks.push('Closing Settings hides the window and keeps the menu app alive')
  await run([helper, String(pid), 'Focus'])
  await app.getByTestId('task-new').waitFor({ timeoutMs: 10000 })
  await waitVisible(true)
  assert.equal((await state()).policy, 1)
  await app.screenshot({ path: join(out, 'menu-focus.png') })
  checks.push('Focus reopens through its native status-menu action with the Dock entry still disabled')
  await Bun.write(join(out, 'results.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), binary, root, pid, checks,
    kind: 'Native accessibility menu actions, actual window close button and macOS running-app policy',
    limits: ['Isolated fixture data; no microphone recording or live inference request.', 'The status-menu actions were invoked through native accessibility rather than a pointer click on the icon.'] }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, out, checks }))
} finally {
  recording = false
  await capture
  await app.close()
  if (captured.length > 1) {
    const list = captured.map((frame, index) => `file '${frame.path}'\nduration ${((captured[index + 1]?.time ?? frame.time + 500) - frame.time) / 1000}`).join('\n')
    await Bun.write(join(frames, 'timeline.txt'), list + `\nfile '${captured.at(-1)!.path}'\n`)
    await run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'timeline.txt'), '-vf', 'scale=1080:760:force_original_aspect_ratio=decrease,pad=1080:760:(ow-iw)/2:(oh-ih)/2:black,setsar=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'walkthrough.mp4')])
  }
}
