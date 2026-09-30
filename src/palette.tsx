import { useEffect, useState } from 'react'
import { nav, sections, tabs, type Section } from './nav'
import { chooseFiles, pasteFiles } from './files'
import { focus } from './focus'
import { focusService } from './focus-state'
import { speech } from './speech-state'
import { liny } from './liny'
import { refreshDock } from './dock'
import { requestCompact } from './panel'
import { C, Empty, Field, Text, space } from './ui'

interface Command { label: string; detail: string; keywords: string; run: () => unknown }
const keywords: Record<string, string> = {
  'Files Shelf': 'drop drag hold bucket', 'Files Settings': 'edge left right pin delay import clear',
  'Talk Record': 'dictate voice microphone scratchpad audio', 'Talk History': 'transcripts search copy', 'Talk Dictionary': 'vocabulary words spelling names import export',
  'Talk Snippets': 'expand trigger signature text', 'Talk Style': 'apps tone natural casual professional verbatim', 'Talk Shortcuts': 'hotkeys keys keyboard hold hands-free',
  'Talk Settings': 'api key openrouter language model cleanup memory screen context history local s1',
  'Write Rewrite': 'grammar rewrite text', 'Write Profiles': 'personality prompt instruction template formal email twitter hotkey', 'Write Notes': 'saved text paste snippet hotkey',
  'Write Settings': 'model output replace clipboard', 'Focus Tasks': 'todo pomodoro timer task project priority', 'Focus History': 'activity streak stats sessions graph',
  'Focus Check-ins': 'mood gratitude daily', 'Focus Settings': 'durations break notifications sound notch menu bar notchflow import',
  'Dock Icons': 'icon pack apply restore reopen', 'Dock New pack': 'artwork images create icns', 'Dock Settings': 'app management refresh keep applied',
  'Liny Chat': 'assistant ask ai message screen capture', 'Liny History': 'conversations sessions', 'Liny Memory': 'remember facts notes',
  'Liny Settings': 'provider codex openrouter model reasoning sidebar shortcut import',
  'Settings General': 'login start search account', 'Settings Permissions': 'microphone accessibility screen recording notifications automation app management',
  'Settings Shortcuts': 'hotkeys keyboard', 'Settings Original apps': 'buddytalk buddywrite notchflow buddyfiles buddydock liny import takeover login items',
}
const commands: Command[] = [
  ...sections.flatMap(section => (tabs[section] as readonly string[]).map(tab => ({
    label: tab === tabs[section][0] ? section : `${section} › ${tab}`, detail: 'Go to', keywords: `${section} ${tab} ${keywords[`${section} ${tab}`] ?? ''}`,
    run: () => nav.go(section, tab as never),
  }))),
  { label: 'Start dictation', detail: 'Talk', keywords: 'record voice microphone', run: () => { nav.go('Talk', 'Record'); void speech().start() } },
  { label: 'Open the compact recorder', detail: 'Talk', keywords: 'small floating', run: () => requestCompact('talk') },
  { label: 'Add files to the shelf', detail: 'Files', keywords: 'choose picker', run: () => { nav.go('Files', 'Shelf'); void chooseFiles() } },
  { label: 'Paste files from the clipboard', detail: 'Files', keywords: 'clipboard', run: () => { nav.go('Files', 'Shelf'); void pasteFiles() } },
  { label: 'Start or pause the timer', detail: 'Focus', keywords: 'pomodoro', run: () => { const running = focusService.getSnapshot().data?.isRunning; void focusService.run(() => focus.timer(running ? 'pause' : 'start')).catch(() => {}) } },
  { label: 'Open the compact timer', detail: 'Focus', keywords: 'small floating', run: () => requestCompact('focus') },
  { label: 'Open the Focus panel', detail: 'Focus', keywords: 'notch notchflow panel tasks timer ducks', run: () => requestCompact('notch') },
  { label: 'New Liny chat', detail: 'Liny', keywords: 'conversation reset', run: () => { nav.go('Liny', 'Chat'); void liny.reset() } },
  { label: 'Refresh the Dock', detail: 'Dock', keywords: 'restart icons', run: () => void refreshDock() },
]

function score(command: Command, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  const label = command.label.toLowerCase(), haystack = `${label} ${command.detail} ${command.keywords}`.toLowerCase()
  if (!words.every(word => haystack.includes(word))) return 0
  return words.reduce((total, word) => total + (label.startsWith(word) ? 4 : label.includes(word) ? 2 : 1), 0)
}

const keyListeners = new Set<(key: string) => boolean>()
export function paletteKey(key: string) { for (const listener of keyListeners) if (listener(key)) return true; return false }

export function Palette() {
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0)
  const results = commands.map(command => ({ command, value: score(command, query) })).filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 9).map(item => item.command)
  const active = Math.min(index, Math.max(0, results.length - 1))
  const run = (command?: Command) => { if (!command) return; nav.palette(false); command.run() }
  useEffect(() => { setIndex(0) }, [query])
  useEffect(() => {
    const listener = (key: string) => {
      if (key === 'down') { setIndex(value => Math.min(value + 1, results.length - 1)); return true }
      if (key === 'up') { setIndex(value => Math.max(value - 1, 0)); return true }
      if (key === 'escape') { nav.palette(false); return true }
      return false
    }
    keyListeners.add(listener)
    return () => { keyListeners.delete(listener) }
  }, [results.length])
  return <div testId="palette" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 96, backgroundColor: '#000000cc' }}>
    <div onMouseDownOutside={() => nav.palette(false)} style={{ display: 'flex', flexDirection: 'column', width: 560, backgroundColor: C.bg, borderWidth: 1, borderColor: C.text }}>
      <div style={{ padding: space.inset }}><Field id="palette-input" value={query} onChange={setQuery} onSubmit={() => run(results[active])} placeholder="Search tools, tabs and actions" autoFocus /></div>
      <div style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderColor: C.line, paddingTop: 4, paddingBottom: 4 }}>
        {results.map((command, position) => <div key={command.label} testId={`palette-item-${position}`} role="button" aria-label={command.label} onClick={() => run(command)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 36, paddingLeft: space.inset * 2 - 1, paddingRight: space.inset * 2 - 1, backgroundColor: position === active ? C.hover : C.bg, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
          <Text>{command.label}</Text><Text muted size={11}>{command.detail}</Text>
        </div>)}
        {results.length === 0 ? <Empty>Nothing matches.</Empty> : null}
      </div>
    </div>
  </div>
}
export const sectionShortcuts: Section[] = sections
