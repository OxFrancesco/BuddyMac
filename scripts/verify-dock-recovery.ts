import { launch } from '@gpuix/react/automation'
import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = await mkdtemp('/private/tmp/buddymac-dock-recovery-')
const out = resolve('evidence/dock-recovery')
await mkdir(out, { recursive: true })
const target = join(root, 'Fixture.app')
await mkdir(join(target, 'Contents/Resources'), { recursive: true })
await Bun.write(join(target, 'Contents/Info.plist'), '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>')
const icon = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
const manifest = join(root, 'pack.json')
await Bun.write(manifest, JSON.stringify({ version: 1, theme: 'Permission recovery', icons: [{ id: 'fixture', name: 'Fixture', appPath: target, bundleIdentifier: null, iconPath: icon, styledIconPath: icon }] }))
const env = { ...process.env, GPUIX_BACKGROUND: '1', LINY_MOCK: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_FOCUS_DIRECT: '1', BUDDYMAC_FOCUS_DISABLE_ALERTS: '1', BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'), BUDDYMAC_LINY_SOURCE_HOME: join(root, 'liny-source'), BUDDYMAC_LEGACY_FILES_DIR: join(root, 'legacy'), BUDDYMAC_LEGACY_DOCK_MANIFEST: manifest, BUDDYMAC_DOCK_NO_REFRESH: '1' }
const packaged = process.env.BUDDYMAC_VERIFY_APP
const app = await launch({ command: packaged ?? process.execPath, args: packaged ? [] : ['src/app.tsx'], env })
const frames = await mkdtemp('/private/tmp/buddymac-recovery-frames-')
const captured: {path: string; time: number}[] = []
let recording = true
const capture = (async () => {
  while (recording) {
    const path = join(frames, `${captured.length}.png`)
    await app.screenshot({ path })
    captured.push({ path, time: performance.now() })
    await Bun.sleep(500)
  }
})()
try {
  await app.getByTestId('nav-Dock').click()
  await app.getByText('Fixture').waitFor({ timeoutMs: 20000 })
  await Bun.sleep(1500)
  await app.getByTestId('dock-select-all').click()
  await app.getByText('Select none').waitFor()
  await chmod(target, 0o500)
  await app.getByTestId('dock-apply').click()
  await app.getByTestId('dock-permission-settings').waitFor()
  await app.getByText('App Management is blocking icon changes for Fixture.').waitFor()
  await Bun.sleep(700)
  await app.screenshot({ path: join(out, 'permission.png') })
  await app.getByTestId('dock-permission-retry').click()
  await app.getByTestId('dock-permission-retry').getByText('Retry').waitFor()
  await app.getByText('App Management is blocking icon changes for Fixture.').waitFor()
  await chmod(target, 0o700)
  await app.getByTestId('dock-permission-retry').click()
  await app.getByText('Applied').waitFor()
  assert(!(await app.call('getPaintedText', {})).text.some((text: string) => text.includes('Enable BuddyMac')))
  await Bun.sleep(700)
  await app.screenshot({ path: join(out, 'recovered.png') })
  await app.getByTestId('dock-keep').click()
  await app.getByText('BuddyMac reapplies these icons every minute while it runs, for example after an app update.').waitFor()
  await chmod(target, 0o500)
  await app.getByTestId('dock-reset').click()
  await app.getByTestId('dock-permission-retry').waitFor()
  const managed = await Bun.file(join(env.BUDDYMAC_DATA_DIR, 'Dock/managed.json')).json()
  assert.equal(managed.icons.length, 1, 'Failed reset must preserve the managed selection')
  await chmod(target, 0o700)
  await app.getByTestId('dock-permission-retry').click()
  await app.getByText('Custom icon missing').waitFor()
  assert.equal((await Bun.file(join(env.BUDDYMAC_DATA_DIR, 'Dock/managed.json')).json()).icons.length, 0)
  await Bun.write(join(env.BUDDYMAC_DATA_DIR, 'Dock/managed.json'), JSON.stringify(managed))
  await chmod(target, 0o500)
  recording = false
  await capture
  await app.getByTestId('nav-Write').click()
  await app.getByTestId('dock-permission-settings').waitFor({ timeoutMs: 70000 })
  await app.screenshot({ path: join(out, 'background-permission.png') })
  await app.getByTestId('dock-permission-settings').click()
  await chmod(target, 0o700)
  await app.getByTestId('dock-permission-retry').click()
  for (let attempt = 0; attempt < 40 && await app.getByTestId('dock-permission-retry').count(); attempt++) await Bun.sleep(100)
  assert.equal(await app.getByTestId('dock-permission-retry').count(), 0)
  console.log('PASS: background repair displays the same recovery controls and retries successfully. Settings button dispatched.');
  console.log('PASS: denied apply shows recovery; retry preserves failure, then succeeds; failed reset preserves managed icons; retry repeats reset correctly. Fixture filesystem denial exercises the helper error path, not a macOS permission grant.')
} catch (error) {
  console.error(await app.call('getPaintedText', {}))
  await app.screenshot({ path: join(out, 'failure.png') })
  throw error
} finally {
  recording = false
  await capture
  await chmod(target, 0o700)
  await app.close()
  if (captured.length > 1) {
    const list = captured.map((frame, index) => `file '${frame.path}'\nduration ${((captured[index + 1]?.time ?? frame.time + 500) - frame.time) / 1000}`).join('\n')
    await Bun.write(join(frames, 'frames.txt'), list + `\nfile '${captured.at(-1)!.path}'\n`)
    const video = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'frames.txt'), '-vf', 'scale=1080:-2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'walkthrough.mp4')], { stdout: 'inherit', stderr: 'inherit' })
    assert.equal(await video.exited, 0)
  }
}
