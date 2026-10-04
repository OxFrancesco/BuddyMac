import { launch } from '@gpuix/react/automation'
import { chmod, mkdir, mkdtemp, readdir, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = await mkdtemp('/private/tmp/buddymac-pi-e2e-')
const out = resolve('evidence/pi')
await mkdir(out, { recursive: true })
const native = join(root, 'native')
await mkdir(native)
for (const file of await readdir('dist/native')) if (file !== 'buddymac-dock-inspector') await symlink(resolve('dist/native', file), join(native, file))
const target = join(root, 'Fixture.app')
await mkdir(join(target, 'Contents/Resources'), { recursive: true })
await Bun.write(join(target, 'Contents/Info.plist'), '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.pi-fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>')
const image = resolve('assets/ducky/frame-00.png')
const inspector = join(native, 'buddymac-dock-inspector')
await Bun.write(inspector, `#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify(${JSON.stringify([{ id: 'fixture', name: 'Fixture app', appPath: target, bundleIdentifier: 'org.buddytools.pi-fixture', iconPath: image }])}));\n`)
await chmod(inspector, 0o700)
const env = { ...process.env, GPUIX_BACKGROUND: '1', LINY_MOCK: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_NATIVE_DIR: native, BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_LINY_HOME: join(root, 'liny'), BUDDYMAC_LINY_SOURCE_HOME: join(root, 'original'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'none.json'), BUDDYMAC_INFERENCE_MOCK: '1', BUDDYMAC_INFERENCE_FIXTURE_IMAGE: image }
const settings = join(env.BUDDYMAC_DATA_DIR, 'Inference/settings.json')
const executable = process.env.BUDDYMAC_VERIFY_APP
const start = () => launch({ command: executable ?? process.execPath, args: executable ? [] : ['src/app.tsx'], env })
let app = await start()
const frames = join(out, 'frames')
await mkdir(frames, { recursive: true })
let recording = true
const captured: { path: string; time: number }[] = []
const capture = (async () => { while (recording) { const path = join(frames, `${String(captured.length).padStart(4, '0')}.png`); await app.screenshot({ path }); captured.push({ path, time: performance.now() }); await Bun.sleep(350) } })()
const checks: string[] = []
async function shot(name: string) { await Bun.sleep(300); await app.screenshot({ path: join(out, `${name}.png`) }) }
try {
  await app.getByTestId('nav-Settings').waitFor({ timeoutMs: 20_000 })
  await app.getByTestId('nav-Settings').click()
  await app.getByTestId('settings-tab-ai').click()
  await app.getByTestId('inference-provider').click()
  await app.getByText('ChatGPT via Codex').click()
  await app.getByTestId('inference-model').waitFor()
  assert.equal((await Bun.file(settings).json()).provider, 'openai-codex')
  await shot('subscription-settings')
  checks.push('Native provider choice persists a ChatGPT subscription provider.')

  await app.getByTestId('nav-Write').click()
  await app.getByTestId('write-input').fill('Make the fixture sentence clear.')
  await app.getByTestId('write-rewrite').click()
  let rewritten = false
  for (let i = 0; i < 60; i++) { rewritten = (await app.call('getPaintedText', {})).text.some((text: string) => text.includes('Fixture rewrite:')); if (rewritten) break; await Bun.sleep(150) }
  assert(rewritten, 'Swift rewrite must return through durable Pi into the native result field.')
  await shot('write-result')
  checks.push('Write goes through the actual Swift bridge and durable Pi, with a provider fixture.')

  await app.getByTestId('nav-Dock').click()
  await app.getByTestId('dock-tab-new-pack').click()
  await app.getByTestId('dock-icon-style').fill('Monochrome clay, soft lighting')
  await app.getByTestId('dock-generate-fixture').waitFor({ timeoutMs: 15_000 })
  await app.getByTestId('dock-generate-fixture').click()
  await app.getByText('Remove').waitFor({ timeoutMs: 15_000 })
  await shot('generated-preview')
  await app.getByTestId('dock-pack-name').fill('Pi fixture')
  await Bun.sleep(300)
  await app.getByTestId('dock-create-pack').click()
  await app.getByText('Pi fixture').waitFor({ timeoutMs: 90_000 })
  await shot('saved-pack')
  const dockSettings = await Bun.file(join(env.BUDDYMAC_DATA_DIR, 'Dock/settings.json')).json()
  const manifest = await Bun.file(dockSettings.packPath).json()
  assert.equal(manifest.icons.length, 1)
  assert(await Bun.file(manifest.icons[0].styledIconPath).exists())
  checks.push('Dock generates a fixture preview and builds a real ICNS pack without applying it.')

  await app.getByTestId('nav-Liny').click()
  await app.getByTestId('liny-input').fill('Check the durable inference fixture.')
  await app.getByTestId('liny-send').click()
  let reply = false
  for (let i = 0; i < 60; i++) { reply = (await app.call('getPaintedText', {})).text.some((text: string) => text.includes('[mock]')); if (reply) break; await Bun.sleep(150) }
  assert(reply, 'Liny must complete a turn with the updated Pi runtime.')
  await shot('liny-result')
  checks.push('Liny completes a turn through Pi 1.0.2 with its existing provider fixture.')
} catch (cause) { await shot('failure'); throw cause }
finally {
  recording = false; await capture; await app.close()
  if (captured.length > 1) {
    await Bun.write(join(frames, 'list.txt'), captured.map((frame, index) => `file '${frame.path}'\nduration ${((captured[index + 1]?.time ?? frame.time + 350) - frame.time) / 1000}`).join('\n') + `\nfile '${captured.at(-1)!.path}'\n`)
    const video = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'), '-vf', 'scale=1080:-2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'walkthrough.mp4')], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env } })
    assert.equal(await video.exited, 0)
  }
}
app = await start()
try {
  await app.getByTestId('nav-Settings').waitFor({ timeoutMs: 20_000 }); await app.getByTestId('nav-Settings').click(); await app.getByTestId('settings-tab-ai').click()
  await app.getByTestId('inference-model').waitFor()
  assert.equal((await Bun.file(settings).json()).provider, 'openai-codex')
  await app.getByTestId('nav-Dock').click(); await app.getByText('Pi fixture').waitFor({ timeoutMs: 15_000 }); await shot('restart-pack')
  checks.push('Provider selection and the generated icon pack survive a fresh app process.')
} finally { await app.close() }
await Bun.write(join(out, 'ui.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), root, executable: executable ?? 'development', kind: 'native end-to-end with isolated stores and provider fixtures', checks, limits: ['No live OAuth or image-provider request in this walkthrough.', 'No microphone capture or real application icon was changed.'] }, null, 2))
console.log(JSON.stringify({ passed: checks.length, checks }))
