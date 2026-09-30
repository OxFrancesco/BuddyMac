import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export interface OriginalApp {
  id: 'files' | 'talk' | 'write' | 'focus' | 'dock' | 'liny'
  name: string
  section: string
  bundleId?: string
  paths: string[]
  loginItem?: string
  launchAgent?: string
}
export interface OriginalStatus { id: OriginalApp['id']; installed: boolean; running: boolean; loginItem: boolean; agentLoaded: boolean }
interface TakeoverRecord { version: 1; takenOverAt: string; loginItems: { name: string; path: string }[]; agents: { label: string; backup: string; original: string }[] }

const home = homedir()
const agents = resolve(home, 'Library/LaunchAgents')
export const originalApps: OriginalApp[] = [
  { id: 'files', name: 'BuddyFiles', section: 'Files', bundleId: 'local.filedropbucket.app', paths: ['/Applications/BuddyFiles.app', resolve(home, 'Applications/BuddyFiles.app'), '/Volumes/T6-7/Coding/Personal/BuddyFiles/build/BuddyFiles.app'], loginItem: 'BuddyFiles' },
  { id: 'talk', name: 'BuddyTalk', section: 'Talk', bundleId: 'org.buddytools.BuddyTalk', paths: ['/Applications/BuddyTalk.app', resolve(home, 'Applications/BuddyTalk.app')], loginItem: 'BuddyTalk' },
  { id: 'write', name: 'BuddyWrite', section: 'Write', bundleId: 'com.francescooddo.BuddyGrammar', paths: ['/Applications/BuddyWrite.app', resolve(home, 'Applications/BuddyWrite.app')], loginItem: 'BuddyGrammar' },
  { id: 'focus', name: 'NotchFlow', section: 'Focus', bundleId: 'com.avg-francesco.NotchFlow', paths: [resolve(home, 'Applications/NotchFlow.app'), '/Applications/NotchFlow.app'] },
  { id: 'dock', name: 'BuddyDock', section: 'Dock', paths: [], launchAgent: 'ai.buddydock.persist' },
  { id: 'liny', name: 'Liny', section: 'Liny', bundleId: 'app.liny.desktop', paths: ['/Applications/Liny.app', resolve(home, 'Applications/Liny.app')], launchAgent: 'app.liny.daemon' },
]
const dataRoot = () => resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(home, 'Library/Application Support/BuddyMac'), 'Takeover')
const recordPath = () => resolve(dataRoot(), 'state.json')
const uid = () => process.getuid?.() ?? 501

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, out: out.trim(), err: err.trim() }
}
const script = (lines: string[], ...args: string[]) => run(['/usr/bin/osascript', ...lines.flatMap(line => ['-e', line]), ...args])
const appPath = (app: OriginalApp) => app.paths.find(path => existsSync(path))

async function loginItems(): Promise<string[]> {
  const result = await script(['tell application "System Events" to get the name of every login item'])
  if (result.code !== 0) throw new Error('BuddyMac needs permission to control System Events to read login items.')
  return result.out ? result.out.split(', ').map(name => name.trim()) : []
}

export async function originalStatuses(): Promise<OriginalStatus[]> {
  const items = await loginItems().catch(() => [] as string[])
  return Promise.all(originalApps.map(async app => {
    const path = appPath(app)
    const running = path ? (await run(['/usr/bin/pgrep', '-f', `${path}/Contents/MacOS/`])).code === 0 : false
    const agentLoaded = app.launchAgent ? (await run(['/bin/launchctl', 'print', `gui/${uid()}/${app.launchAgent}`])).code === 0 : false
    return { id: app.id, installed: !!path || (!!app.launchAgent && existsSync(resolve(agents, `${app.launchAgent}.plist`))), running, loginItem: !!app.loginItem && items.includes(app.loginItem), agentLoaded }
  }))
}

async function readRecord(): Promise<TakeoverRecord | null> {
  const file = Bun.file(recordPath())
  return await file.exists() ? await file.json() as TakeoverRecord : null
}
async function writeRecord(record: TakeoverRecord) {
  await mkdir(dataRoot(), { recursive: true, mode: 0o700 })
  const temporary = `${recordPath()}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(record, null, 2)); await chmod(temporary, 0o600); await rename(temporary, recordPath())
}
export const takenOver = async () => !!await readRecord()

/** Quits the originals and stops them from starting at login. App bundles and their data are left alone. */
export async function stopOriginals(ids: OriginalApp['id'][] = originalApps.map(app => app.id)): Promise<string[]> {
  const problems: string[] = []
  const record: TakeoverRecord = await readRecord() ?? { version: 1, takenOverAt: new Date().toISOString(), loginItems: [], agents: [] }
  const items = await loginItems().catch(error => { problems.push(error instanceof Error ? error.message : String(error)); return [] as string[] })
  for (const app of originalApps.filter(entry => ids.includes(entry.id))) {
    const path = appPath(app)
    if (app.bundleId && path && (await run(['/usr/bin/pgrep', '-f', `${path}/Contents/MacOS/`])).code === 0) {
      // BuddyMac's Focus helper shares NotchFlow's bundle identifier for iCloud, so NotchFlow is stopped by path.
      const quit = app.id === 'focus'
        ? await run(['/usr/bin/pkill', '-TERM', '-f', `${path}/Contents/MacOS/`])
        : await script(['on run argv', 'tell application id (item 1 of argv) to quit', 'end run'], app.bundleId)
      if (quit.code !== 0) problems.push(`${app.name} did not quit.`)
    }
    if (app.loginItem && items.includes(app.loginItem)) {
      const itemPath = await script(['on run argv', 'tell application "System Events" to get the path of login item (item 1 of argv)', 'end run'], app.loginItem)
      const removed = await script(['on run argv', 'tell application "System Events" to delete login item (item 1 of argv)', 'end run'], app.loginItem)
      if (removed.code === 0) record.loginItems.push({ name: app.loginItem, path: itemPath.out || path || '' })
      else problems.push(`${app.name} could not be removed from login items.`)
    }
    if (app.launchAgent) {
      const plist = resolve(agents, `${app.launchAgent}.plist`)
      if (existsSync(plist)) {
        await run(['/bin/launchctl', 'bootout', `gui/${uid()}`, plist])
        const backup = resolve(dataRoot(), 'LaunchAgents', `${app.launchAgent}.plist`)
        await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
        await rename(plist, backup)
        record.agents.push({ label: app.launchAgent, backup, original: plist })
      }
    }
  }
  await writeRecord(record)
  return problems
}

/** Puts back every login item and launch agent that stopOriginals removed. */
export async function restoreOriginals(): Promise<string[]> {
  const record = await readRecord()
  if (!record) return []
  const problems: string[] = []
  for (const item of record.loginItems) {
    if (!item.path) continue
    const added = await script(['on run argv', 'tell application "System Events" to make login item at end with properties {path:(item 1 of argv), hidden:false}', 'end run'], item.path)
    if (added.code !== 0) problems.push(`${item.name} could not be added back to login items.`)
  }
  for (const agent of record.agents) {
    if (!existsSync(agent.backup)) continue
    await rename(agent.backup, agent.original)
    const loaded = await run(['/bin/launchctl', 'bootstrap', `gui/${uid()}`, agent.original])
    if (loaded.code !== 0 && !loaded.err.includes('already')) problems.push(`${agent.label} could not be started again.`)
  }
  await rm(recordPath(), { force: true })
  return problems
}

export async function openOriginal(app: OriginalApp) {
  const path = appPath(app)
  if (!path) throw new Error(`${app.name} is not installed.`)
  await run(['/usr/bin/open', path])
}
