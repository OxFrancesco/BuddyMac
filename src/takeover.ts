import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { focus } from './focus'
import { focusService } from './focus-state'
import { setSpeechShortcuts } from './speech-shortcuts'
import { importLegacyFiles } from './files'
import { loadEdgeSettings, saveEdgeSettings } from './edge'
import { getManaged, loadCurrentPack, setManaged } from './dock'
import { setLogin } from './platform'
import { stopOriginals } from './originals'
import { originalLinyPreferences, surfaces } from './surfaces'

const owned = (path: string) => { try { return statSync(path).uid === process.getuid?.() } catch { return false } }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Everything "Take over" does, in one place so the Settings button and the first-run flow agree. */
export async function makeBuddyMacMain(): Promise<string[]> {
  const problems = await stopOriginals()
  const attempt = async (label: string, work: () => Promise<unknown>) => { try { await work() } catch (error) { problems.push(`${label}: ${message(error)}`) } }
  await attempt('Focus', () => focusService.run(() => focus.useNotchFlowStore()))
  await attempt('Files', () => importLegacyFiles())
  await attempt('Files edge', async () => {
    const file = Bun.file(`${process.env.HOME}/Library/Application Support/FileDropBucket/settings.json`)
    const original = await file.exists() ? await file.json() as { dock?: string; keepOpen?: boolean; autoShow?: boolean; holdDelay?: number; onlyFiles?: boolean } : {}
    const current = await loadEdgeSettings()
    await saveEdgeSettings({ ...current, side: original.dock === 'left' ? 'left' : 'right', pinned: original.keepOpen ?? false, autoShow: original.autoShow ?? true, holdDelay: Math.min(3, Math.max(0.2, original.holdDelay ?? current.holdDelay)), onlyFiles: original.onlyFiles ?? true })
  })
  await attempt('Liny', async () => {
    const liny = await originalLinyPreferences()
    await surfaces.update(current => ({ ...current, focusNotch: true, focusMenuBar: true, talkPill: true, ...liny ? { linySidebar: liny.linySidebar, linyShortcuts: { open: liny.linyShortcuts.open ?? current.linyShortcuts.open, capture: liny.linyShortcuts.capture ?? current.linyShortcuts.capture } } : {} }))
  })
  await attempt('Shortcuts', () => setSpeechShortcuts(true))
  await attempt('Start at login', async () => { setLogin(true) })
  await attempt('Dock', async () => {
    const pack = await loadCurrentPack() ?? await getManaged()
    if (pack) await setManaged(pack, pack.icons.filter(icon => icon.applyMethod === 'finder' && owned(icon.appPath)).map(icon => icon.appPath))
  })
  return problems
}


/** `BuddyMac --takeover` runs the same steps once at launch and records what happened. */
export async function takeoverFromLaunch(): Promise<string[]> {
  const problems = await makeBuddyMacMain()
  const directory = resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), 'Library/Application Support/BuddyMac'), 'Takeover')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await Bun.write(resolve(directory, 'last-run.json'), JSON.stringify({ ranAt: new Date().toISOString(), problems }, null, 2))
  return problems
}
