import { launch } from '@gpuix/react/automation'
import { chmod, mkdir, mkdtemp, readdir, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// Dock batch generation against isolated stores: select all, three requests at a time, one failure kept selected.
const root = await mkdtemp('/private/tmp/buddymac-dock-batch-')
const out = resolve(process.argv[2] ?? 'evidence/dock-batch')
await mkdir(out, { recursive: true })
const native = join(root, 'native')
await mkdir(native)
for (const file of await readdir('dist/native')) if (file !== 'buddymac-dock-inspector') await symlink(resolve('dist/native', file), join(native, file))
const image = resolve('assets/ducky/frame-00.png')
const names = ['Atlas', 'Beacon', 'Cobalt', 'Drift', 'Ember', 'Broken']
const apps = []
for (const name of names) {
  const target = join(root, `${name}.app`)
  await mkdir(join(target, 'Contents/Resources'), { recursive: true })
  await Bun.write(join(target, 'Contents/Info.plist'), `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.batch.${name.toLowerCase()}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`)
  apps.push({ id: name.toLowerCase(), name, appPath: target, bundleIdentifier: `org.buddytools.batch.${name.toLowerCase()}`, iconPath: image })
}
const inspector = join(native, 'buddymac-dock-inspector')
await Bun.write(inspector, `#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify(${JSON.stringify(apps)}));\n`)
await chmod(inspector, 0o700)
const log = join(root, 'requests.jsonl')
const env = { ...process.env, GPUIX_BACKGROUND: '1', LINY_MOCK: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_NATIVE_DIR: native, BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'),
  BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_LINY_HOME: join(root, 'liny'), BUDDYMAC_LINY_SOURCE_HOME: join(root, 'original'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'none.json'),
  BUDDYMAC_INFERENCE_MOCK: '1', BUDDYMAC_INFERENCE_FIXTURE_IMAGE: image, BUDDYMAC_INFERENCE_FIXTURE_DELAY_MS: '1500', BUDDYMAC_INFERENCE_FIXTURE_LOG: log, BUDDYMAC_INFERENCE_FIXTURE_FAIL: '"Broken"' }
const executable = process.env.BUDDYMAC_VERIFY_APP
const app = await launch({ command: executable ?? process.execPath, args: executable ? [] : ['src/app.tsx'], env })
const frames = join(out, 'frames')
await mkdir(frames, { recursive: true })
let recording = true
const captured: { path: string; time: number }[] = []
const capture = (async () => { while (recording) { const path = join(frames, `${String(captured.length).padStart(4, '0')}.png`); await app.screenshot({ path }); captured.push({ path, time: performance.now() }); await Bun.sleep(250) } })()
const checks: string[] = []
const shot = (name: string) => app.screenshot({ path: join(out, `${name}.png`) })
const painted = async () => (await app.call('getPaintedText', {})).text as string[]
try {
  await app.getByTestId('nav-Dock').waitFor({ timeoutMs: 20_000 })
  await app.getByTestId('nav-Dock').click()
  await app.getByTestId('dock-tab-new-pack').click()
  await app.getByTestId('dock-pick-atlas').waitFor({ timeoutMs: 15_000 })
  await app.getByTestId('dock-icon-style').fill('Claymation black and white')
  await app.getByTestId('dock-select-all').click()
  assert((await painted()).includes('Generate 6 icons'))
  await shot('selected')
  checks.push('Select all picks every Dock app and the button names how many icons it will generate')

  await app.getByTestId('dock-generate-selected').click()
  await Bun.sleep(700)
  assert.equal((await painted()).filter(text => text === 'Generating').length, 3)
  await shot('generating')
  checks.push('Three icons show Generating while the other three wait')

  // The fixture appends while this polls; only lines ending in a newline are complete.
  let rows: { prompt: string; started: number; ended: number }[] = []
  for (let i = 0; i < 80 && rows.length < names.length; i++) { await Bun.sleep(150); rows = (await Bun.file(log).exists()) ? (await Bun.file(log).text()).split('\n').slice(0, -1).map(line => JSON.parse(line)) : [] }
  assert.equal(rows.length, names.length)
  const overlap = Math.max(...rows.map(row => rows.filter(other => other.started < row.ended && other.ended > row.started).length))
  assert.equal(overlap, 3)
  checks.push(`All ${names.length} requests ran, never more than ${overlap} at once`)

  await app.getByText('Fixture provider refused this icon.').waitFor({ timeoutMs: 10_000 })
  const text = await painted()
  assert(text.includes('Generate 1 icon'), 'Only the failed app stays selected.')
  assert(text.some(line => line.includes('Broken could not be generated')))
  assert.equal(text.filter(line => line.endsWith('.png')).length, 5)
  await shot('finished')
  checks.push('Five icons are ready, and the failed app stays selected with its error for a retry')

  await app.getByTestId('dock-pack-name').fill('Batch fixture')
  await Bun.sleep(300)
  await app.getByTestId('dock-create-pack').click()
  await app.getByText('Batch fixture').waitFor({ timeoutMs: 90_000 })
  const dockSettings = await Bun.file(join(env.BUDDYMAC_DATA_DIR, 'Dock/settings.json')).json()
  assert.equal((await Bun.file(dockSettings.packPath).json()).icons.length, 5)
  await shot('pack')
  checks.push('The five generated icons build one ICNS pack')
  await Bun.write(join(out, 'results.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), executable: executable ?? 'development', root, checks, kind: 'native end-to-end with isolated stores and a paced image fixture' }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, out, checks }))
} catch (cause) { await shot('failure'); throw cause }
finally {
  recording = false; await capture; await app.close()
  if (captured.length > 1) {
    await Bun.write(join(frames, 'list.txt'), captured.map((frame, index) => `file '${frame.path}'\nduration ${((captured[index + 1]?.time ?? frame.time + 350) - frame.time) / 1000}`).join('\n') + `\nfile '${captured.at(-1)!.path}'\n`)
    const video = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'), '-vf', 'scale=1080:-2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'walkthrough.mp4')], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env } })
    assert.equal(await video.exited, 0)
  }
}
