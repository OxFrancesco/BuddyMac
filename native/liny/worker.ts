import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { activeProfile, importProfile, linyHome, listImportSources, profilePaths } from './storage'

process.env.LINY_HOME = linyHome()
const packagedOcu = join(dirname(process.execPath), '../Resources/Open Computer Use.app/Contents/MacOS/OpenComputerUse')
if (process.env.BUDDYMAC_LINY_OCU_BIN) process.env.LINY_OCU_BIN = process.env.BUDDYMAC_LINY_OCU_BIN
else if (existsSync(packagedOcu)) process.env.LINY_OCU_BIN = packagedOcu
else {
  const developmentOcu = join(dirname(process.execPath), '../native/liny/ocu/Open Computer Use.app/Contents/MacOS/OpenComputerUse')
  if (existsSync(developmentOcu)) process.env.LINY_OCU_BIN = developmentOcu
}
const [{ Gateway }, { createRuntime }, { defaultConfig, loadConfig }, { parseClientRequest }, { acquireLock, releaseLock }] = await Promise.all([
  import('./agent/src/gateway'), import('./agent/src/agent-runtime'), import('./agent/src/config'), import('./agent/src/protocol'), import('./agent/src/process-lock'),
])
mkdirSync(linyHome(), { recursive: true, mode: 0o700 })
const lock = join(linyHome(), 'worker.lock')
if (!acquireLock(lock)) { process.stderr.write('BuddyMac Liny is already running.\n'); process.exit(75) }
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const client = { id: crypto.randomUUID(), send: (frame: string) => process.stdout.write(`${frame}\n`) }
function createGateway() {
  const storage = profilePaths()
  const config = loadConfig(storage.configPath)
  const personal = config.provider === 'liny' ? { ...config, provider: defaultConfig().provider, model: defaultConfig().model } : config
  const gateway = new Gateway(createRuntime(storage.authPath), personal, storage.sessionPath, storage)
  gateway.addClient(client)
  return gateway
}
let gateway = createGateway()
let importing = false
function stop() { gateway.stop(); releaseLock(lock); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
process.on('exit', () => releaseLock(lock))
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('close', stop)
lines.on('line', line => { void handle(line) })
async function handle(line: string) {
  let id = -1
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) throw new Error('Invalid Liny request')
    id = value.id
    if (importing) throw new Error('Profile import is in progress')
    let payload: unknown
    if ('method' in value && value.method === 'import.sources') payload = { sources: listImportSources(), activeProfile: activeProfile(), mode: 'personal', managedBilling: false }
    else if ('method' in value && value.method === 'import.profile') {
      if (!('params' in value) || typeof value.params !== 'object' || value.params === null || !('id' in value.params) || typeof value.params.id !== 'string') throw new Error('Select an original Liny profile')
      if (gateway.isBusy) throw new Error('Stop the active turn before importing a profile')
      importing = true
      try {
        payload = importProfile(value.params.id, 'includeCredentials' in value.params && value.params.includeCredentials === true)
        gateway.stop(); gateway = createGateway()
      } finally { importing = false }
    } else {
      const request = parseClientRequest(value)
      if ((request.method === 'auth.login' || request.method === 'auth.logout') && request.params.provider === 'liny') throw new Error('Managed Liny billing is not available in BuddyMac; choose a personal provider')
      if (request.method === 'config.set' && request.params.selection?.provider === 'liny') throw new Error('Choose a personal provider')
      payload = await gateway.handleRequest(client, request)
    }
    emit({ type: 'res', id, ok: true, payload })
  } catch (error) { emit({ type: 'res', id, ok: false, error: error instanceof Error ? error.message : 'Liny request failed' }) }
}
