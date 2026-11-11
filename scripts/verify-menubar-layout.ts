// Opt-in live check of Menu Bar › Layout against the installed app and the real menu bar. It moves one real icon
// across BuddyMac's divider and back, so the icon ends where it started. Quit BuddyMac first.
// bun scripts/verify-menubar-layout.ts [bundleId] [name] [outDir]
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { launchInstalled } from './launch-installed'

const target = process.argv[2] ?? 'pl.maketheweb.cleanshotx'
const label = process.argv[3] ?? 'CleanShot X'
const out = process.argv[4] ?? '/private/tmp/buddymac-menubar-layout'
await mkdir(out, { recursive: true })
const root = await mkdtemp('/private/tmp/buddymac-menubar-')
await mkdir(join(root, 'data'), { recursive: true })
await Bun.write(join(root, 'data/surfaces.json'), JSON.stringify({ menuBar: { enabled: true, autoHide: 0, hideOnLaunch: false }, focusNotch: false, focusMenuBar: false, talkPill: false }))
const app = await launchInstalled({ GPUIX_BACKGROUND: '1', BUDDYMAC_VERIFY_MENUBAR: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LEGACY_FILES_DIR: join(root, 'none'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'none.json') })
const shot = (name: string) => app.screenshot({ path: join(out, `${name}.png`) })
const painted = async () => (await app.call('getPaintedText', {})).text as string[]
const side = async (name: string) => { const text = await painted(); const shown = text.findIndex(value => value.startsWith('Always shown')), hidden = text.findIndex(value => value.startsWith('Hidden behind')), at = text.indexOf(name); return at < 0 ? 'missing' : at < hidden && at > shown ? 'shown' : 'hidden' }
try {
  await Bun.sleep(3000)
  await app.getByTestId('nav-Menu Bar').click()
  await app.getByText('Allow').waitFor({ timeoutMs: 1500 }).then(() => { throw new Error('BuddyMac does not have Accessibility. Allow it in Menu Bar › Layout first.') }, () => {})
  for (let i = 0; i < 40 && !(await painted()).some(text => text.startsWith('Always shown')); i++) await Bun.sleep(250)
  await shot('layout')
  const button = app.getByTestId(`menubar-move-${target}||0`)
  const name = label
  const before = await side(name)
  console.log('before', name, before)
  assert.notEqual(before, 'missing')
  for (const step of ['moved', 'restored']) {
    await button.click()
    let now = before
    for (let i = 0; i < 60; i++) { await Bun.sleep(250); now = await side(name); if ((step === 'moved') === (now !== before) && !(await painted()).includes('Moving')) break }
    await shot(step)
    console.log(step, name, now)
    assert.equal(now, step === 'moved' ? (before === 'shown' ? 'hidden' : 'shown') : before, `${name} did not ${step === 'moved' ? 'move' : 'return'}`)
    await Bun.sleep(1000)
  }
  console.log(JSON.stringify({ passed: true, target, out }))
} catch (cause) { await shot('failure'); throw cause }
finally { await app.close() }
