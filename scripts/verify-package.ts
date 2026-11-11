import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const app = resolve(process.argv[2] ?? 'dist/BuddyMac.app')
const binary = join(app, 'Contents/MacOS/BuddyMac')
const root = await mkdtemp('/private/tmp/buddymac-package-')
const env = {
  ...process.env,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  BUDDYMAC_DATA_DIR: join(root, 'data'),
  BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'),
}
try {
  // Liny was removed: neither its agent nor its computer-use helpers may ship.
  for (const path of ['Contents/MacOS/buddymac-liny', 'Contents/MacOS/buddymac-default-browser', 'Contents/Resources/Open Computer Use.app', 'Contents/Resources/Licenses/Liny-SOURCE.md'])
    assert(!existsSync(join(app, path)), `The package must not ship ${path}`)
  const probe = Bun.spawn([binary, '--check-runtime'], { env, stdout: 'pipe', stderr: 'pipe' })
  const [output, error, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited])
  assert.equal(code, 0, error)
  assert.equal(JSON.parse(output).gpuixNativeLoaded, true)
  console.log(JSON.stringify({ app, nativeRuntime: 'passed', linyRemoved: true, externalBunRequired: false }))
} finally {
  await rm(root, { recursive: true, force: true })
}
