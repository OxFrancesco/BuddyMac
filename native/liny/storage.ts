import { existsSync, readdirSync, readFileSync, mkdirSync, lstatSync, copyFileSync, chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface ImportSource { id: string; label: string; sessionFiles: number; hasMemory: boolean }
export const linyHome = () => process.env.BUDDYMAC_LINY_HOME ?? join(homedir(), 'Library/Application Support/BuddyMac/Liny')
const originalHome = () => process.env.BUDDYMAC_LINY_SOURCE_HOME ?? join(homedir(), '.liny')
const validId = (id: string) => id === 'legacy' || /^user_[A-Za-z0-9]+$/.test(id)
const directory = (path: string) => { try { return lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() } catch { return false } }
export function listImportSources(): ImportSource[] {
  const root = originalHome(); const sources: { id: string; path: string }[] = []
  const accounts = join(root, 'accounts')
  if (directory(accounts)) for (const id of readdirSync(accounts)) {
    if (/^user_[A-Za-z0-9]+$/.test(id) && directory(join(accounts, id))) sources.push({ id, path: join(accounts, id) })
  }
  if (existsSync(join(root, 'session/main.jsonl')) || directory(join(root, 'session/pi-sessions'))) sources.push({ id: 'legacy', path: root })
  return sources.map(({ id, path }) => {
    const sessions = join(path, id === 'legacy' ? 'session/pi-sessions' : 'pi-sessions')
    return { id, label: id === 'legacy' ? 'Original local profile' : id, sessionFiles: directory(sessions) ? readdirSync(sessions).filter(name => name.endsWith('.jsonl')).length : 0, hasMemory: existsSync(join(path, 'memory/MEMORY.md')) }
  })
}
export function activeProfile(): string {
  try { const value: unknown = JSON.parse(readFileSync(join(linyHome(), 'active-profile.json'), 'utf8')); if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && (value.id === 'personal' || validId(value.id))) return value.id } catch {}
  return 'personal'
}
export function profilePaths(id = activeProfile()) {
  if (id !== 'personal' && !validId(id)) throw new Error('Invalid Liny profile')
  const root = join(linyHome(), 'profiles', id)
  for (const path of [root, join(root, 'memory/daily')]) mkdirSync(path, { recursive: true, mode: 0o700 })
  return { root, sessionPath: join(root, 'session.jsonl'), authPath: join(root, 'auth.json'), configPath: join(root, 'config.json'), memory: { memoryFile: join(root, 'memory/MEMORY.md'), dailyDirectory: join(root, 'memory/daily'), dreamStateFile: join(root, 'dream-state.json') } }
}
function copyPrivate(source: string, destination: string): void {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error('Import does not follow symbolic links')
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: 0o700 })
    for (const name of readdirSync(source)) copyPrivate(join(source, name), join(destination, name))
  } else if (stat.isFile()) { copyFileSync(source, destination); chmodSync(destination, 0o600) }
}
export function importProfile(id: string, includeCredentials: boolean): { id: string; alreadyImported: boolean } {
  if (!validId(id) || !listImportSources().some(source => source.id === id)) throw new Error('Choose an available original Liny profile')
  const home = linyHome(); const destination = join(home, 'profiles', id)
  mkdirSync(join(home, 'profiles'), { recursive: true, mode: 0o700 })
  const marker = join(destination, 'imported.json')
  const alreadyImported = existsSync(marker)
  if (!alreadyImported) {
    if (existsSync(destination)) throw new Error('Destination profile already contains data; import will not overwrite it')
    const source = id === 'legacy' ? originalHome() : join(originalHome(), 'accounts', id)
    const staging = join(home, 'profiles', `.import-${crypto.randomUUID()}`)
    mkdirSync(staging, { mode: 0o700 })
    try {
      const mappings = [['config.json', 'config.json'], ['memory', 'memory'], ['computer-workflows.json', 'computer-workflows.json'], ['dream-state.json', 'dream-state.json'], [id === 'legacy' ? 'session/main.jsonl' : 'session.jsonl', 'session.jsonl'], [id === 'legacy' ? 'session/pi-sessions' : 'pi-sessions', 'pi-sessions']]
      if (includeCredentials) mappings.push(['auth.json', 'auth.json'])
      for (const [from, to] of mappings) if (from && to && existsSync(join(source, from))) copyPrivate(join(source, from), join(staging, to))
      writeFileSync(join(staging, 'imported.json'), JSON.stringify({ version: 1, source: id, credentials: includeCredentials, importedAt: new Date().toISOString() }), { mode: 0o600 })
      renameSync(staging, destination)
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error }
  }
  const temporary = join(home, `active-profile-${crypto.randomUUID()}.json`)
  writeFileSync(temporary, JSON.stringify({ id }), { mode: 0o600 }); renameSync(temporary, join(home, 'active-profile.json'))
  return { id, alreadyImported }
}
