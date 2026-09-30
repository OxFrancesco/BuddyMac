import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'buddymac-focus-client-'))
process.env.BUDDYMAC_FOCUS_HOME = home
process.env.BUDDYMAC_FOCUS_DISABLE_ALERTS = '1'
process.env.BUDDYMAC_FOCUS_HELPER = resolve(import.meta.dir, '../dist/buddymac-focus')
const { focusClient } = await import('./focus')
afterAll(async () => { focusClient.close(); await rm(home, { recursive: true, force: true }) })

test('a request sent right after restarting the Focus service is answered by the new process', async () => {
  await focusClient.request('snapshot')
  // Never write unless the helper is provably on the throwaway store.
  expect(focusClient.info?.store.startsWith(home)).toBe(true)
  await focusClient.request('task-add', { title: 'Survives restart', notes: '', projectName: '', tags: [], priority: 'p2' })
  focusClient.close()
  const snapshot = await focusClient.request('snapshot')
  expect(snapshot.tasks.map(task => task.title)).toContain('Survives restart')
  expect(focusClient.info?.shared).toBe(false)
}, 20_000)
