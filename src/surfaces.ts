import { useSyncExternalStore } from 'react'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { chmod, mkdir, rename } from 'node:fs/promises'

export interface StoredShortcut { keyCode: number; modifiers: number; label: string }
export interface SurfaceSettings {
  linySidebar: { enabled: boolean; edge: 'left' | 'right'; zone: 'top' | 'middle' | 'bottom' | 'entireEdge' }
  linyShortcuts: { open: StoredShortcut | null; capture: StoredShortcut | null }
  focusNotch: boolean
  focusMenuBar: boolean
  talkPill: boolean
}
export const defaultSurfaces: SurfaceSettings = {
  linySidebar: { enabled: false, edge: 'right', zone: 'middle' },
  linyShortcuts: { open: null, capture: null },
  focusNotch: false,
  focusMenuBar: true,
  talkPill: true,
}
const path = () => resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), 'Library/Application Support/BuddyMac'), 'surfaces.json')
let state: SurfaceSettings = defaultSurfaces
const listeners = new Set<() => void>()
const publish = (next: SurfaceSettings) => { state = next; for (const listener of listeners) listener() }

function shortcut(value: unknown): StoredShortcut | null {
  if (typeof value !== 'object' || value === null || !('keyCode' in value) || !('modifiers' in value) || !('label' in value)) return null
  return typeof value.keyCode === 'number' && typeof value.modifiers === 'number' && typeof value.label === 'string' ? { keyCode: value.keyCode, modifiers: value.modifiers, label: value.label } : null
}
function parse(value: unknown): SurfaceSettings {
  const item = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const sidebar = typeof item.linySidebar === 'object' && item.linySidebar !== null ? item.linySidebar as Record<string, unknown> : {}
  const shortcuts = typeof item.linyShortcuts === 'object' && item.linyShortcuts !== null ? item.linyShortcuts as Record<string, unknown> : {}
  const zones = ['top', 'middle', 'bottom', 'entireEdge'] as const
  return {
    linySidebar: {
      enabled: sidebar.enabled === true,
      edge: sidebar.edge === 'left' ? 'left' : 'right',
      zone: zones.find(zone => zone === sidebar.zone) ?? 'middle',
    },
    linyShortcuts: { open: shortcut(shortcuts.open), capture: shortcut(shortcuts.capture) },
    focusNotch: item.focusNotch === true,
    focusMenuBar: item.focusMenuBar !== false,
    talkPill: item.talkPill !== false,
  }
}

export const surfaces = {
  get: () => state,
  async load() { const file = Bun.file(path()); publish(await file.exists() ? parse(await file.json()) : defaultSurfaces); return state },
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

/** Reads the original Liny app's window mode and global shortcuts so takeover keeps the same habits. */
export async function originalLinyPreferences(): Promise<Pick<SurfaceSettings, 'linySidebar' | 'linyShortcuts'> | null> {
  const child = Bun.spawn(['/usr/bin/defaults', 'export', 'app.liny.desktop', '-'], { stdout: 'pipe', stderr: 'ignore' })
  const [xml, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) return null
  const read = (key: string) => xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]
  const zones = ['top', 'middle', 'bottom', 'entireEdge'] as const
  let open: StoredShortcut | null = null, capture: StoredShortcut | null = null
  const data = xml.match(/<key>appShortcuts<\/key>\s*<data>([^<]*)<\/data>/)?.[1]
  if (data) {
    try {
      const list: unknown = JSON.parse(Buffer.from(data.replace(/\s+/g, ''), 'base64').toString('utf8'))
      if (Array.isArray(list)) for (let index = 0; index + 1 < list.length; index += 2) {
        const entry = list[index + 1] as { key?: unknown; keyCode?: unknown; modifiers?: unknown }
        const value = typeof entry?.keyCode === 'number' && typeof entry.modifiers === 'number' ? { keyCode: entry.keyCode, modifiers: entry.modifiers, label: typeof entry.key === 'string' ? entry.key.toUpperCase() : '' } : null
        if (list[index] === 'open') open = value
        if (list[index] === 'capture') capture = value
      }
    } catch {}
  }
  return {
    linySidebar: { enabled: read('windowMode') === 'sidebar', edge: read('sidebarEdge') === 'left' ? 'left' : 'right', zone: zones.find(zone => zone === read('sidebarZone')) ?? 'middle' },
    linyShortcuts: { open, capture },
  }
}
