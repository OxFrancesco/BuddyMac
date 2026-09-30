import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { LinyClient, type LinyEvent } from './liny'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'buddymac-liny-test-'))
  const home = join(directory, 'home'); const original = join(directory, 'original'); const ocuLog = join(directory, 'ocu.log')
  const env = { BUDDYMAC_LINY_HOME: home, BUDDYMAC_LINY_SOURCE_HOME: original, LINY_MOCK: '1', BUDDYMAC_DEFAULT_BROWSER_HELPER: resolve(import.meta.dir, '../native/liny/fixtures/browser-stub.ts'), BUDDYMAC_LINY_OCU_BIN: resolve(import.meta.dir, '../native/liny/fixtures/ocu-stub.ts'), BUDDYMAC_LINY_TEST_OCU_LOG: ocuLog }
  const client = new LinyClient({ env })
  return { directory, home, original, ocuLog, env, client }
}
async function waitForExit(home: string) {
  for (let i = 0; i < 40 && existsSync(join(home, 'worker.lock')); i++) await Bun.sleep(25)
}

describe('Liny engine integration with synthetic model and computer backend', () => {
  test('does not warm tools on launch; streams and preserves actual Pi sessions across restart', async () => {
    const f = await fixture(); const events: LinyEvent[] = []; f.client.onEvent(event => events.push(event))
    let resumed: LinyClient | undefined
    try {
      const state = await f.client.state()
      expect(state.authSource).toBe('Mock')
      expect(existsSync(f.ocuLog)).toBe(false)
      const before = await f.client.snapshot()
      await f.client.send('Synthetic persistence fixture alpha')
      expect(events.some(event => event.event === 'delta')).toBe(true)
      expect(events.some(event => event.event === 'turn.done')).toBe(true)
      const after = await f.client.snapshot()
      expect(after.messages).toHaveLength(2)
      expect(after.messages[1]?.text).toContain('[mock]')
      expect(existsSync(f.ocuLog)).toBe(false)
      const reset = await f.client.reset()
      expect(reset.id).not.toBe(before.id)
      expect((await f.client.sessions()).sessions).toHaveLength(2)
      await f.client.resume(before.id)
      f.client.close(); await waitForExit(f.home)
      resumed = new LinyClient({ env: f.env })
      const persistent = await resumed.snapshot()
      expect(persistent.id).toBe(before.id)
      expect(persistent.messages).toEqual(after.messages)
      await resumed.send('/remember synthetic-test-memory')
      const notes = await readdir(join(f.home, 'profiles/personal/memory/daily'))
      expect(await readFile(join(f.home, 'profiles/personal/memory/daily', notes[0]!), 'utf8')).toContain('synthetic-test-memory')
    } finally { resumed?.close(); f.client.close(); await waitForExit(f.home); await rm(f.directory, { recursive: true, force: true }) }
  }, 30_000)
  test('imports only the selected account; leaves credentials and originals untouched by default', async () => {
    const f = await fixture()
    try {
      const account = join(f.original, 'accounts/user_SyntheticA'); const other = join(f.original, 'accounts/user_SyntheticB')
      await mkdir(join(account, 'memory'), { recursive: true }); await mkdir(other, { recursive: true })
      await writeFile(join(account, 'memory/MEMORY.md'), 'Synthetic selected account memory')
      await writeFile(join(account, 'auth.json'), '{"synthetic":"not-a-real-secret"}')
      await writeFile(join(other, 'session.jsonl'), 'Synthetic other account sentinel')
      const sources = await f.client.importSources()
      expect(sources.sources.map(s => s.id).sort()).toEqual(['user_SyntheticA', 'user_SyntheticB'])
      await f.client.importSource('user_SyntheticA')
      expect(existsSync(join(f.home, 'profiles/user_SyntheticA/auth.json'))).toBe(false)
      expect(existsSync(join(f.home, 'profiles/user_SyntheticB'))).toBe(false)
      expect(await readFile(join(f.home, 'profiles/user_SyntheticA/memory/MEMORY.md'), 'utf8')).toBe('Synthetic selected account memory')
      expect(await readFile(join(account, 'memory/MEMORY.md'), 'utf8')).toBe('Synthetic selected account memory')
      expect(existsSync(f.ocuLog)).toBe(false)
      await expect(f.client.importSource('../user_SyntheticB')).rejects.toThrow()
    } finally { f.client.close(); await waitForExit(f.home); await rm(f.directory, { recursive: true, force: true }) }
  }, 30_000)
})

test('an explicit computer tool starts the synthetic backend only on execution', async () => {
  const f = await fixture()
  try {
    expect(existsSync(f.ocuLog)).toBe(false)
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../native/liny/fixtures/explicit-tool.ts')], { env: { ...process.env, ...f.env }, stdout: 'pipe', stderr: 'pipe' })
    const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new Error(error)
    expect(existsSync(f.ocuLog)).toBe(true)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})
