import { launch } from '@gpuix/react/automation'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// History and Check-ins with a year's worth of data, and what a running timer costs while History is open.
// Seeds an isolated store through the Focus helper's test clock: one-minute work sessions, finished one by one.
const sessions = Number(process.argv[3] ?? 300), checkIns = 60
const root = await mkdtemp('/private/tmp/buddymac-focus-history-')
const out = resolve(process.argv[2] ?? 'evidence/focus-history')
await mkdir(out, { recursive: true })
const profile = join(root, 'profile.json')
const env = { ...process.env, GPUIX_BACKGROUND: '1', BUDDYMAC_PROFILE: profile,
  BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'),
  BUDDYMAC_LEGACY_FILES_DIR: join(root, 'no-legacy'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'no-pack.json') }
async function focus(command: string, now: number, input = '') {
  const child = Bun.spawn([resolve('dist/buddymac-focus'), command], { env: { ...env, BUDDYMAC_FOCUS_TEST_NOW: String(now) }, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' })
  child.stdin.write(input); child.stdin.end()
  assert.equal(await child.exited, 0, `buddymac-focus ${command}`)
}
let now = Date.now() / 1000 - sessions * 3600
await focus('settings', now, JSON.stringify({ workDurationMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 1, longBreakEvery: 12, notificationsEnabled: false, playSoundOnTransitions: false, autoStartNextPhase: false }))
for (let index = 0; index < sessions; index++, now += 3600) {
  await focus('timer-start', now)
  await focus('timer-tick', now + 61)
  await focus('timer-skip', now + 62)
}
for (let day = 0; day < checkIns; day++) await focus('check-in', now, JSON.stringify({ day: new Date(Date.now() - day * 86_400_000).toISOString(), mood: 1 + day % 5, text: day % 3 ? '' : 'A synthetic check-in with a longer note so rows differ in height.' }))
await focus('settings', Date.now() / 1000, JSON.stringify({ workDurationMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, notificationsEnabled: false, playSoundOnTransitions: false, autoStartNextPhase: false }))

const packaged = process.env.BUDDYMAC_VERIFY_APP
const app = await launch({ command: packaged ?? process.execPath, args: packaged ? [] : ['src/app.tsx'], env })
const commitsSince = async (since: number) => (await Bun.file(profile).json() as { at: number; ms: number }[]).filter(commit => commit.at >= since)
try {
  await app.getByTestId('nav-Focus').click()
  await app.getByTestId('timer-toggle').waitFor({ timeoutMs: 15000 })
  await app.getByTestId('timer-toggle').click()
  await app.getByTestId('timer-toggle').getByText('Pause').waitFor()
  await app.getByTestId('focus-tab-history').click()
  await Bun.sleep(2000)
  const start = Date.now()
  await Bun.sleep(10_000)
  const commits = await commitsSince(start)
  const ms = commits.reduce((sum, commit) => sum + commit.ms, 0)
  await app.screenshot({ path: join(out, 'history.png') })
  await app.getByTestId('history-list').wheel(0, -4000)
  await Bun.sleep(400)
  await app.screenshot({ path: join(out, 'history-scrolled.png') })
  await app.getByTestId('focus-tab-check-ins').click()
  await app.getByTestId('checkin-list').waitFor({ timeoutMs: 8000 })
  await app.screenshot({ path: join(out, 'check-ins.png') })
  await app.getByTestId('focus-tab-tasks').click()
  await app.getByTestId('timer-toggle').click()
  await app.getByTestId('timer-toggle').getByText('Start').waitFor()
  const result = { sessions, checkIns, historyCommitsIn10s: commits.length, historyCommitMs: +ms.toFixed(1), worstCommitMs: +Math.max(0, ...commits.map(commit => commit.ms)).toFixed(1) }
  await Bun.write(join(out, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await app.close() }
