import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LinyClient } from '../src/liny'

const app = resolve(process.argv[2] ?? 'dist/BuddyMac.app')
const binary = join(app, 'Contents/MacOS/BuddyMac')
const root = await mkdtemp('/private/tmp/buddymac-package-')
const env = {
  ...process.env,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LINY_MOCK: '1',
  BUDDYMAC_LINY_HOME: join(root, 'liny'),
  BUDDYMAC_LINY_SOURCE_HOME: join(root, 'original'),
  BUDDYMAC_DATA_DIR: join(root, 'data'),
  BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'),
  BUDDYMAC_LINY_OCU_BIN: join(root, 'must-not-start-computer'),
  BUDDYMAC_DEFAULT_BROWSER_HELPER: join(root, 'must-not-start-browser'),
}
let client: LinyClient | undefined
async function closeClient() {
  client?.close()
  for (let i = 0; i < 80 && existsSync(join(env.BUDDYMAC_LINY_HOME, 'worker.lock')); i++) await Bun.sleep(25)
  assert(!existsSync(join(env.BUDDYMAC_LINY_HOME, 'worker.lock')), 'Liny must release its process lock')
}
try {
  assert(!existsSync(join(app, 'Contents/MacOS/buddymac-liny')), 'The package must not ship a second Bun executable')
  const probe = Bun.spawn([binary, '--check-runtime'], { env, stdout: 'pipe', stderr: 'pipe' })
  const [output, error, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited])
  assert.equal(code, 0, error)
  assert.equal(JSON.parse(output).gpuixNativeLoaded, true)
  client = new LinyClient({ command: [binary, '--liny-worker'], env })
  assert.equal((await client.state()).authSource, 'Mock')
  let replyFinished = false
  let turnError = ''
  client.onEvent(event => {
    if (event.event === 'turn.done') replyFinished = true
    if (event.event === 'turn.error') turnError = event.message
  })
  await client.send('Shared runtime packaging fixture', [], { tools: 'none' })
  for (let i = 0; i < 100 && !replyFinished && !turnError; i++) await Bun.sleep(50)
  assert.equal(turnError, '')
  assert(replyFinished, 'The packaged agent must finish its reply')
  const snapshot = await client.snapshot()
  assert.equal(snapshot.messages.length, 2)
  assert(snapshot.messages[1]?.text.includes('[mock]'))
  await closeClient()
  client = new LinyClient({ command: [binary, '--liny-worker'], env })
  const restored = await client.snapshot()
  assert.equal(restored.id, snapshot.id)
  assert.deepEqual(restored.messages, snapshot.messages)
  console.log(JSON.stringify({ app, nativeRuntime: 'passed', linySubprocess: 'passed', sessionRestart: 'passed', externalBunRequired: false }))
} finally {
  await closeClient()
  await rm(root, { recursive: true, force: true })
}
