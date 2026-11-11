import { useSyncExternalStore } from 'react'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { chmod, mkdir, rename } from 'node:fs/promises'

export interface SurfaceSettings {
  /** Icons left of BuddyMac's divider are hidden until the arrow is clicked. `autoHide` is seconds, 0 for never. */
  menuBar: MenuBarSettings
  focusNotch: boolean
  focusMenuBar: boolean
  talkPill: boolean
}
export interface MenuBarSettings { enabled: boolean; autoHide: number; hideOnLaunch: boolean }
export const autoHideChoices = [0, 5, 10, 15, 30, 60] as const
export const defaultSurfaces: SurfaceSettings = {
  menuBar: { enabled: false, autoHide: 10, hideOnLaunch: true },
  focusNotch: true,
  focusMenuBar: true,
  talkPill: true,
}
const path = () => resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), 'Library/Application Support/BuddyMac'), 'surfaces.json')
let state: SurfaceSettings = defaultSurfaces, loaded = false
const listeners = new Set<() => void>()
const publish = (next: SurfaceSettings) => { state = next; for (const listener of listeners) listener() }

function parse(value: unknown): SurfaceSettings {
  const item = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const bar = typeof item.menuBar === 'object' && item.menuBar !== null ? item.menuBar as Record<string, unknown> : {}
  return {
    menuBar: {
      enabled: bar.enabled === true,
      autoHide: autoHideChoices.find(value => value === bar.autoHide) ?? defaultSurfaces.menuBar.autoHide,
      hideOnLaunch: bar.hideOnLaunch !== false,
    },
    focusNotch: item.focusNotch !== false,
    focusMenuBar: item.focusMenuBar !== false,
    talkPill: item.talkPill !== false,
  }
}

export const surfaces = {
  get: () => state,
  /** True once the saved settings have been read, so launch-only behaviour does not act on the defaults. */
  isLoaded: () => loaded,
  async load() { const file = Bun.file(path()); const next = await file.exists() ? parse(await file.json()) : defaultSurfaces; loaded = true; publish(next); return state },
  async save(next: SurfaceSettings) {
    const destination = path()
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, JSON.stringify(next, null, 2)); await chmod(temporary, 0o600); await rename(temporary, destination)
    publish(next)
  },
  update(change: (current: SurfaceSettings) => SurfaceSettings) { return surfaces.save(change(state)) },
}
export function useSurfaces() { return useSyncExternalStore(subscribe, () => state) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
