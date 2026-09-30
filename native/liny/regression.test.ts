import { expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, symlink, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { LinyClient } from '../../src/liny'
import { submitLinyMessage } from '../../src/liny-submission'

async function runSyntheticTurn(tools: 'none' | 'computer') {
 const home = await mkdtemp('/private/tmp/buddymac-liny-lazy-test-')
 const client = new LinyClient({ env: { LINY_MOCK: '1', BUDDYMAC_LINY_HOME: home, BUDDYMAC_LINY_OCU_BIN: '/missing-computer-helper-for-regression', BUDDYMAC_DEFAULT_BROWSER_HELPER: tools === 'none' ? '/missing-browser-helper-for-regression' : resolve(import.meta.dir, 'fixtures/browser-stub.ts') } })
 let reply = '', activities = 0
 let unsubscribe = () => {}
 const complete = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Synthetic turn timed out')), 10_000)
  unsubscribe = client.onEvent(event => {
   if (event.event === 'delta') reply += event.text
   if (event.event === 'tool.activity') activities++
   if (event.event === 'turn.done') { clearTimeout(timeout); resolve() }
   if (event.event === 'turn.error') { clearTimeout(timeout); reject(new Error(event.message)) }
  })
 })
 try {
  await client.send('Synthetic ordinary text response', [], { tools })
  await complete
  expect(reply).toContain('[mock]')
  expect(activities).toBe(0)
  expect((await client.snapshot()).messages).toHaveLength(2)
 } finally {
  unsubscribe(); client.close()
  for (let i = 0; i < 40 && existsSync(join(home, 'worker.lock')); i++) await Bun.sleep(25)
  await rm(home, { recursive: true, force: true })
 }
}
test('explicit no-tools turn needs neither computer helper nor default-browser helper', () => runSyntheticTurn('none'), 15_000)
test('ordinary response with tools available does not initialize the computer helper', () => runSyntheticTurn('computer'), 15_000)

async function isolatedLiny() {
 const directory = await mkdtemp('/private/tmp/buddymac-liny-features-')
 const home = join(directory, 'home'), original = join(directory, 'original')
 const env = { LINY_MOCK: '1', BUDDYMAC_LINY_HOME: home, BUDDYMAC_LINY_SOURCE_HOME: original, BUDDYMAC_LINY_OCU_BIN: '/missing-computer-helper-for-regression', BUDDYMAC_DEFAULT_BROWSER_HELPER: '/missing-browser-helper-for-regression' }
 const client = new LinyClient({ env })
 const close = async () => {
  client.close()
  for (let i = 0; i < 80 && existsSync(join(home, 'worker.lock')); i++) await Bun.sleep(25)
  await rm(directory, { recursive: true, force: true })
 }
 return { directory, home, original, env, client, close }
}
function nextEvent(client: LinyClient, name: import('../../src/liny').LinyEvent['event']) {
 let unsubscribe = () => {}
 return new Promise<import('../../src/liny').LinyEvent>((resolve, reject) => {
  const timeout = setTimeout(() => { unsubscribe(); reject(new Error(`Missing synthetic event: ${name}`)) }, 10_000)
  unsubscribe = client.onEvent(event => {
   if (event.event === name) { clearTimeout(timeout); unsubscribe(); resolve(event) }
  })
 })
}
async function syntheticSend(client: LinyClient, text: string, images: { data: string; mimeType: string }[] = []) {
 const done = nextEvent(client, 'turn.done')
 await client.send(text, images, { tools: 'none' })
 await done
}

test('model/thinking configuration survives restart and rejects unavailable selections', async () => {
 const f = await isolatedLiny()
 let restarted: LinyClient | undefined
 try {
  const state = await f.client.state()
  const model = state.models[0]!
  expect(state.providers.map(provider => provider.id)).not.toContain('liny')
  const configured = await f.client.configure({ provider: 'openai-codex', model: model.id }, 'high')
  expect(configured.model).toBe(model.id)
  expect(configured.thinking).toBe('high')
  await expect(f.client.configure({ provider: 'openai-codex', model: 'unavailable-synthetic-model' })).rejects.toThrow('not available')
  expect((await f.client.state()).thinking).toBe('high')
  f.client.close()
  for (let i = 0; i < 80 && existsSync(join(f.home, 'worker.lock')); i++) await Bun.sleep(25)
  restarted = new LinyClient({ env: f.env })
  expect((await restarted.state()).thinking).toBe('high')
  expect((await restarted.state()).model).toBe(model.id)
 } finally { restarted?.close(); await f.close() }
}, 15_000)

test('attachments persist in real session storage and malformed requests do not append history', async () => {
 const f = await isolatedLiny()
 try {
  await expect(f.client.send('   ', [], { tools: 'none' })).rejects.toThrow('empty message')
  await expect(f.client.send('bad attachment', [{ data: 'fixture', mimeType: 'text/plain' }], { tools: 'none' })).rejects.toThrow('must be an image')
  await expect(f.client.send('too many', Array.from({ length: 11 }, () => ({ data: 'fixture', mimeType: 'image/png' })), { tools: 'none' })).rejects.toThrow('at most 10')
  expect((await f.client.snapshot()).messages).toHaveLength(0)
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  await syntheticSend(f.client, 'Synthetic one-pixel image fixture', [{ data: png, mimeType: 'image/png' }])
  const before = await f.client.snapshot()
  expect(before.messages[0]?.hasImages).toBe(true)
  expect(before.messages[1]?.text).toContain('[image attached]')
  await f.client.reset()
  expect((await f.client.resume(before.id)).messages).toEqual(before.messages)
  await expect(f.client.resume('../another-account')).rejects.toThrow('not found in this account')
  expect((await f.client.snapshot()).id).toBe(before.id)
 } finally { await f.close() }
}, 15_000)

test('active turn cancellation releases the worker for the next turn and blocks session mutations', async () => {
 const f = await isolatedLiny()
 try {
  await f.client.state()
  const started = nextEvent(f.client, 'turn.started'), done = nextEvent(f.client, 'turn.done')
  const sending = f.client.send('Synthetic abort fixture '.repeat(400), [], { tools: 'none' })
  await started
  await expect(f.client.reset()).rejects.toThrow('turn already running')
  await expect(f.client.send('concurrent fixture', [], { tools: 'none' })).rejects.toThrow('turn already running')
  await f.client.abort()
  await done; await sending
  const reset = await f.client.reset()
  expect(reset.messages).toHaveLength(0)
  await syntheticSend(f.client, 'Synthetic after cancellation')
  expect((await f.client.snapshot()).messages[1]?.text).toContain('after cancellation')
  await f.client.abort()
 } finally { await f.close() }
}, 15_000)

test('slash memory/reset and failed commands distinguish completion from acknowledgement', async () => {
 const f = await isolatedLiny()
 try {
  const notice = nextEvent(f.client, 'notice')
  await f.client.send('/remember synthetic-memory-marker', [], { tools: 'none' })
  expect((await notice).event).toBe('notice')
  let memory = ''
  const unsubscribe = f.client.onEvent(event => { if (event.event === 'delta') memory += event.text })
  await syntheticSend(f.client, '/memory')
  unsubscribe()
  expect(memory).toContain('synthetic-memory-marker')
  const failed = nextEvent(f.client, 'turn.error')
  await f.client.send('/unknownSyntheticCommand', [], { tools: 'none' })
  const error = await failed
  expect(error.event === 'turn.error' && error.message).toContain('unknown command')
  const previous = (await f.client.snapshot()).id
  await f.client.send('/new', [], { tools: 'none' })
  expect((await f.client.snapshot()).id).not.toBe(previous)
  expect((await f.client.sessions()).sessions).toHaveLength(2)
 } finally { await f.close() }
}, 15_000)

test('synthetic authentication events and empty-key validation use the IPC contract', async () => {
 const f = await isolatedLiny()
 try {
  await expect(f.client.login('openai-codex', { method: 'api_key', key: '  ' })).rejects.toThrow('non-empty')
  const auth = nextEvent(f.client, 'auth.ok')
  expect((await f.client.login('openai-codex', { method: 'api_key', key: 'synthetic-fixture-not-a-real-key' })).authSource).toBe('Mock')
  await auth
  const loggedOut = nextEvent(f.client, 'auth.state')
  await f.client.logout('openai-codex')
  expect((await loggedOut).event).toBe('auth.state')
 } finally { await f.close() }
}, 15_000)

test('one isolated home cannot be owned by two workers', async () => {
 const f = await isolatedLiny()
 const duplicate = new LinyClient({ env: f.env })
 try {
  await f.client.state()
  await expect(duplicate.state()).rejects.toThrow('stopped (75)')
  expect((await f.client.snapshot()).messages).toHaveLength(0)
 } finally { duplicate.close(); await f.close() }
}, 15_000)


test('selected-profile credential import preserves source, sessions and edits across profile switching', async () => {
 const f = await isolatedLiny()
 try {
  await syntheticSend(f.client, 'Synthetic source conversation')
  const sourceSession = await f.client.snapshot()
  const account = join(f.original, 'accounts/user_FixtureA')
  await cp(join(f.home, 'profiles/personal'), account, { recursive: true })
  const credential = JSON.stringify({ synthetic: { type: 'api_key', key: 'synthetic-fixture-only' } })
  await writeFile(join(account, 'auth.json'), credential)
  await mkdir(join(f.original, 'accounts/user_FixtureB'), { recursive: true })
  const sources = await f.client.importSources()
  expect(sources.sources.find(source => source.id === 'user_FixtureA')?.sessionFiles).toBe(1)
  expect((await f.client.importSource('user_FixtureA', true)).messages).toEqual(sourceSession.messages)
  expect(await readFile(join(f.home, 'profiles/user_FixtureA/auth.json'), 'utf8')).toBe(credential)
  await syntheticSend(f.client, 'Synthetic destination-only edit')
  const edited = await f.client.snapshot()
  expect(edited.messages).toHaveLength(4)
  expect((await f.client.importSource('user_FixtureB')).messages).toHaveLength(0)
  await expect(f.client.resume(sourceSession.id)).rejects.toThrow('not found in this account')
  expect((await f.client.importSource('user_FixtureA')).messages).toEqual(edited.messages)
  expect(await readFile(join(account, 'auth.json'), 'utf8')).toBe(credential)
  const originalFiles = await readdir(join(account, 'pi-sessions'))
  const conversation = originalFiles.find(file => file.endsWith('.jsonl'))!
  expect(await readFile(join(account, 'pi-sessions', conversation), 'utf8')).not.toContain('destination-only edit')
 } finally { await f.close() }
}, 15_000)

test('profile import rejects symlink content and occupied destinations without changing selection', async () => {
 const f = await isolatedLiny()
 try {
  const account = join(f.original, 'accounts/user_Symlink')
  await mkdir(account, { recursive: true })
  await writeFile(join(f.directory, 'outside-note'), 'Synthetic outside file')
  await symlink(join(f.directory, 'outside-note'), join(account, 'memory'))
  const before = await f.client.snapshot()
  await expect(f.client.importSource('user_Symlink')).rejects.toThrow('symbolic links')
  expect((await f.client.snapshot()).id).toBe(before.id)
  expect(existsSync(join(f.home, 'profiles/user_Symlink'))).toBe(false)
  expect((await readdir(join(f.home, 'profiles'))).some(file => file.startsWith('.import-'))).toBe(false)
  await mkdir(join(f.original, 'accounts/user_Occupied'), { recursive: true })
  await mkdir(join(f.home, 'profiles/user_Occupied'), { recursive: true })
  await writeFile(join(f.home, 'profiles/user_Occupied/sentinel'), 'Synthetic destination content')
  await expect(f.client.importSource('user_Occupied')).rejects.toThrow('will not overwrite')
  expect(await readFile(join(f.home, 'profiles/user_Occupied/sentinel'), 'utf8')).toBe('Synthetic destination content')
  expect((await f.client.importSources()).activeProfile).toBe('personal')
 } finally { await f.close() }
}, 15_000)

test('legacy local-profile import maps session paths and keeps credentials excluded', async () => {
 const f = await isolatedLiny()
 try {
  await syntheticSend(f.client, 'Synthetic legacy session')
  const existing = await f.client.snapshot()
  await mkdir(join(f.original, 'session'), { recursive: true })
  await cp(join(f.home, 'profiles/personal/pi-sessions'), join(f.original, 'session/pi-sessions'), { recursive: true })
  await writeFile(join(f.original, 'auth.json'), '{}')
  expect((await f.client.importSources()).sources.map(source => source.id)).toEqual(['legacy'])
  const imported = await f.client.importSource('legacy')
  expect(imported.id).toBe(existing.id)
  expect(imported.messages).toEqual(existing.messages)
  expect(existsSync(join(f.home, 'profiles/legacy/auth.json'))).toBe(false)
 } finally { await f.close() }
}, 15_000)


test('composer submission exits busy on notice-only/reset commands and rejected requests', async () => {
 const f = await isolatedLiny()
 const engine = { send: (text: string, images: { data: string; mimeType: string }[] = []) => f.client.send(text, images, { tools: 'none' }), snapshot: () => f.client.snapshot() }
 let busy = false
 const states: boolean[] = []
 const setBusy = (next: boolean) => { busy = next; states.push(next) }
 try {
  let doneEvents = 0
  f.client.onEvent(event => { if (event.event === 'turn.done') doneEvents++ })
  const remembered = await submitLinyMessage(engine, '/remember synthetic-composer-memory', [], setBusy)
  expect(busy).toBe(false)
  expect(remembered.messages).toHaveLength(0)
  expect(doneEvents).toBe(0)
  const reset = await submitLinyMessage(engine, '/new', [], setBusy)
  expect(busy).toBe(false)
  expect(reset.id).not.toBe(remembered.id)
  expect(doneEvents).toBe(0)
  await expect(submitLinyMessage(engine, ' ', [], setBusy)).rejects.toThrow('empty message')
  expect(busy).toBe(false)
  expect(states).toEqual([true, false, true, false, true, false])
  const message = await submitLinyMessage(engine, 'Synthetic composer after commands', [], setBusy)
  expect(busy).toBe(false)
  expect(message.messages).toHaveLength(2)
  expect(doneEvents).toBe(1)
 } finally { await f.close() }
}, 15_000)
