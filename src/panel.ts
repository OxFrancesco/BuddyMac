import { dlopen, FFIType } from 'bun:ffi'
import { dirname, resolve } from 'node:path'

export type PanelMode = 'normal' | 'focus' | 'talk' | 'liny' | 'notch' | 'files'
export type CompactMode = Exclude<PanelMode, 'normal' | 'files'>
const root = process.env.BUDDYMAC_NATIVE_DIR ?? (process.execPath.includes('.app/Contents/MacOS/')
  ? dirname(process.execPath) : resolve(import.meta.dir, '../dist/native'))
const library = dlopen(resolve(root, 'libbuddymac-panel.dylib'), {
  buddymac_panel_mode: { args: [FFIType.int], returns: FFIType.int },
  buddymac_panel_current_mode: { args: [], returns: FFIType.int },
  buddymac_panel_sidebar_edge: { args: [FFIType.int], returns: FFIType.void },
  buddymac_panel_hide: { args: [], returns: FFIType.int },
  buddymac_panel_restore: { args: [FFIType.bool], returns: FFIType.int },
  buddymac_panel_present: { args: [], returns: FFIType.void },
  buddymac_panel_files_edge: { args: [FFIType.int], returns: FFIType.void },
})
const listeners = new Set<(mode: PanelMode) => void>()

export function setPanelMode(mode: PanelMode): void {
  const result = library.symbols.buddymac_panel_mode(mode === 'focus' ? 1 : mode === 'talk' ? 2 : mode === 'liny' ? 3 : mode === 'notch' ? 4 : mode === 'files' ? 5 : 0)
  if (result === 1) return
  if (result === -2) throw new Error('The BuddyMac window is not ready.')
  if (result === -3) throw new Error('Leave fullscreen before opening a compact panel.')
  if (result === -4) throw new Error('No display is available for the compact panel.')
  throw new Error('The compact window mode could not be applied.')
}

export function getPanelMode(): PanelMode {
  const mode = library.symbols.buddymac_panel_current_mode()
  if (mode === 1) return 'focus'
  if (mode === 2) return 'talk'
  if (mode === 3) return 'liny'
  if (mode === 4) return 'notch'
  if (mode === 5) return 'files'
  return 'normal'
}

export const setSidebarEdge = (edge: 'left' | 'right') => library.symbols.buddymac_panel_sidebar_edge(edge === 'left' ? 1 : 2)
export const setFilesEdge = (edge: 'left' | 'right') => library.symbols.buddymac_panel_files_edge(edge === 'left' ? 1 : 2)
export const presentPanel = () => library.symbols.buddymac_panel_present()
export function restorePanel(front: boolean): void { if (library.symbols.buddymac_panel_restore(front) !== 1) throw new Error('The BuddyMac window is not ready.') }
export function hidePanel(): void { if (library.symbols.buddymac_panel_hide() !== 1) throw new Error('The BuddyMac window is not ready.') }

export function requestCompact(mode: PanelMode): void {
  for (const listener of listeners) listener(mode)
}

export function subscribeCompact(listener: (mode: PanelMode) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
