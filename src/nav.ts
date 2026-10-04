import { useSyncExternalStore } from 'react'

export const tabs = {
  Files: ['Shelf', 'Settings'],
  Talk: ['Record', 'History', 'Dictionary', 'Snippets', 'Style', 'Shortcuts', 'Settings'],
  Write: ['Rewrite', 'Profiles', 'Notes', 'Settings'],
  Focus: ['Tasks', 'History', 'Check-ins', 'Settings'],
  Dock: ['Icons', 'New pack', 'Settings'],
  Liny: ['Chat', 'History', 'Memory', 'Settings'],
  Settings: ['General', 'AI', 'Permissions', 'Shortcuts', 'Original apps'],
} as const
export type Section = keyof typeof tabs
export type Tab<S extends Section> = typeof tabs[S][number]
export const sections = Object.keys(tabs) as Section[]
export const isSection = (value: string): value is Section => value in tabs

interface NavState { section: Section; tabs: { [S in Section]: Tab<S> }; paletteOpen: boolean }
let state: NavState = {
  section: 'Files',
  tabs: { Files: 'Shelf', Talk: 'Record', Write: 'Rewrite', Focus: 'Tasks', Dock: 'Icons', Liny: 'Chat', Settings: 'General' },
  paletteOpen: false,
}
const listeners = new Set<() => void>()
function update(next: Partial<NavState>) { state = { ...state, ...next }; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => state

export const nav = {
  get: snapshot,
  go<S extends Section>(section: S, tab?: Tab<S>) { update({ section, tabs: tab ? { ...state.tabs, [section]: tab } : state.tabs, paletteOpen: false }) },
  palette(open: boolean) { update({ paletteOpen: open }) },
}
export function useNav() { return useSyncExternalStore(subscribe, snapshot) }
export function useTab<S extends Section>(section: S): [Tab<S>, (tab: Tab<S>) => void] {
  const current = useNav().tabs[section] as Tab<S>
  return [current, tab => nav.go(section, tab)]
}
