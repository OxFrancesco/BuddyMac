import { useEffect, useRef, useState } from 'react'
import { addFiles, chooseFiles, clearFiles, copyFiles, importLegacyFiles, listFiles, openFile, pasteFiles, removeFiles, revealFiles, type ShelfFile } from './files'
import { defaultEdgeSettings, loadEdgeSettings, saveEdgeSettings, type EdgeSettings } from './edge'
import { dragFiles } from './platform'
import { tabs, useTab } from './nav'
import { Button, C, Check, Empty, ErrorText, Field, Group, Row, Setting, TabbedPage, Text } from './ui'

let cachedFiles: ShelfFile[] | null = null

export function FilesView({ shelf = false }: { shelf?: boolean }) {
  const [files, setFiles] = useState<ShelfFile[]>(cachedFiles ?? [])
  const [loaded, setLoaded] = useState(cachedFiles !== null)
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useTab('Files')
  const [confirmClear, setConfirmClear] = useState(false)
  const [edge, setEdge] = useState<EdgeSettings>(defaultEdgeSettings)
  const [delay, setDelay] = useState(String(defaultEdgeSettings.holdDelay))
  const [savingEdge, setSavingEdge] = useState(false)
  const selection = useRef<string[]>([])
  const anchor = useRef<string | null>(null)
  const drag = useRef<{ x: number; y: number; paths: string[] } | null>(null)
  const suppressClick = useRef(false)
  const refreshToken = useRef(0)
  const pending = useRef(0)
  const compact = shelf
  const shown = files.filter(file => file.name.toLowerCase().includes(query.toLowerCase()))

  function select(paths: string[]) { selection.current = paths; setSelected(paths) }
  function acceptFiles(next: ShelfFile[]) {
    cachedFiles = next
    setLoaded(true)
    setFiles(next)
    select(selection.current.filter(path => next.some(file => file.path === path)))
  }
  async function refresh() {
    const token = ++refreshToken.current
    try {
      const next = await listFiles()
      if (refreshToken.current === token && pending.current === 0) acceptFiles(next)
    } catch (cause) {
      if (refreshToken.current === token) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  async function run(action: () => Promise<ShelfFile[]>) {
    pending.current++
    refreshToken.current++
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      pending.current--
      if (pending.current === 0) { setBusy(false); void refresh() }
    }
  }
  async function updateEdge(next: EdgeSettings) {
    setSavingEdge(true)
    setError('')
    try { await saveEdgeSettings(next); setEdge(next); setDelay(String(next.holdDelay)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSavingEdge(false) }
  }
  function saveDelay() {
    const value = Number(delay)
    if (!Number.isFinite(value) || value < 0.2 || value > 3) { setError('Enter a delay between 0.2 and 3 seconds.'); return }
    void updateEdge({ ...edge, holdDelay: value })
  }
  function selectGesture(path: string, modifiers: { cmd?: boolean; shift?: boolean } | undefined, preserveGroup: boolean) {
    const current = selection.current
    if (modifiers?.shift) {
      const from = shown.findIndex(file => file.path === (anchor.current ?? path))
      const to = shown.findIndex(file => file.path === path)
      const range = from < 0 || to < 0 ? [path] : shown.slice(Math.min(from, to), Math.max(from, to) + 1).map(file => file.path)
      const next = modifiers.cmd ? [...new Set([...current, ...range])] : range
      select(next)
      return next
    }
    anchor.current = path
    const next = modifiers?.cmd ? current.includes(path) ? current.filter(item => item !== path) : [...current, path]
      : preserveGroup && current.includes(path) ? current : [path]
    select(next)
    return next
  }

  useEffect(() => {
    void refresh()
    void loadEdgeSettings().then(value => { setEdge(value); setDelay(String(value.holdDelay)) }).catch(cause => setError(String(cause)))
    const timer = setInterval(() => { if (pending.current === 0) void refresh() }, 2000)
    return () => { clearInterval(timer); refreshToken.current++ }
  }, [])

  const settings = <>
    <Group title="Window">
      <Setting label="Where the shelf lives" detail="An edge shelf slides out when you hover the screen edge or hold a dragged file.">
        <Button id="files-edge-off" primary={edge.side === 'off'} disabled={savingEdge} onClick={() => void updateEdge({ ...edge, side: 'off' })}>Window</Button>
        <Button id="files-edge-left" primary={edge.side === 'left'} disabled={savingEdge} onClick={() => void updateEdge({ ...edge, side: 'left' })}>Left edge</Button>
        <Button id="files-edge-right" primary={edge.side === 'right'} disabled={savingEdge} onClick={() => void updateEdge({ ...edge, side: 'right' })}>Right edge</Button>
      </Setting>
      <Setting label="Keep the shelf open"><Check id="files-edge-pin" label={edge.pinned ? 'Pinned' : 'Hides when you move away'} checked={edge.pinned} disabled={savingEdge || edge.side === 'off'} onChange={pinned => void updateEdge({ ...edge, pinned })} /></Setting>
      <Setting label="Show while dragging" detail="Hold a dragged item for the delay below and the shelf appears."><Check id="files-edge-auto" label={edge.autoShow ? 'On' : 'Off'} checked={edge.autoShow} disabled={savingEdge || edge.side === 'off'} onChange={autoShow => void updateEdge({ ...edge, autoShow })} /></Setting>
      <Setting label="Only for file drags" detail="Ignore text selections and tab drags."><Check id="files-edge-only-files" label={edge.onlyFiles ? 'On' : 'Off'} checked={edge.onlyFiles} disabled={savingEdge || edge.side === 'off' || !edge.autoShow} onChange={onlyFiles => void updateEdge({ ...edge, onlyFiles })} /></Setting>
      <Setting label="Hold delay" detail="Seconds, between 0.2 and 3."><div style={{ width: 76 }}><Field id="files-edge-delay" value={delay} onChange={setDelay} onSubmit={saveDelay} placeholder="Seconds" /></div><Button id="files-edge-save-delay" disabled={savingEdge} onClick={saveDelay}>Save</Button></Setting>
    </Group>
    <Group title="Shelf">
      <Setting label="Import from BuddyFiles" detail="Adds files still held in the original BuddyFiles shelf."><Button id="files-import" disabled={busy} onClick={() => void run(importLegacyFiles)}>Import</Button></Setting>
      <Setting label="Clear the shelf" detail="Removes every file from the shelf. The files stay where they are.">{confirmClear ? <><Button id="files-clear-confirm" disabled={busy} onClick={() => { setConfirmClear(false); void run(clearFiles) }}>Clear shelf</Button><Button onClick={() => setConfirmClear(false)}>Cancel</Button></> : <Button id="files-clear" disabled={busy || files.length === 0} onClick={() => setConfirmClear(true)}>Clear</Button>}</Setting>
    </Group>
  </>
  const shelfContent = <>
    {compact ? <Row style={{ flexShrink: 0 }}>
      <Button id="files-paste" disabled={busy} onClick={() => void run(pasteFiles)}>Paste files</Button>
      <Button id="files-add" primary disabled={busy} onClick={() => void run(chooseFiles)}>Add files</Button>
    </Row> : null}
    <div style={{ flexShrink: 0 }}><Field id="files-search" value={query} onChange={setQuery} placeholder="Find a file" /></div>
    <ErrorText message={error} />
    <div testId="file-shelf" onFileDrop={event => { const paths = event.paths; if (paths?.length) void run(() => addFiles(paths)) }} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: compact ? 80 : 160, overflowY: 'scroll', borderTopWidth: 1, borderColor: C.line }}>
      {!loaded ? null : shown.length === 0 ? <Empty>{query ? 'No matching files.' : 'Drop files here, paste them, or choose Add files.'}</Empty> : shown.map(file => <div key={file.path} testId={`file-${file.name}`} role="button" aria-label={file.name} tabIndex={0}
        onClick={event => {
          if (suppressClick.current) { suppressClick.current = false; return }
          if (event.clickCount === 2) { void run(() => openFile(file.path)); return }
          if (!event.modifiers?.cmd && !event.modifiers?.shift) selectGesture(file.path, undefined, false)
        }}
        onMouseDown={event => {
          if (event.button !== undefined && event.button !== 0) return
          suppressClick.current = false
          const paths = selectGesture(file.path, event.modifiers, true)
          drag.current = paths.includes(file.path) ? { x: event.x ?? 0, y: event.y ?? 0, paths } : null
        }}
        onMouseUp={() => { drag.current = null }}
        onMouseMove={event => {
          if (event.pressedButton !== 0) { drag.current = null; return }
          const start = drag.current
          if (!start || Math.hypot((event.x ?? 0) - start.x, (event.y ?? 0) - start.y) <= 6) return
          drag.current = null
          suppressClick.current = true
          if (!dragFiles(start.paths)) setError('The drag could not start. Try again, or use Copy.')
        }}
        onKeyDown={event => {
          if (event.key === 'space') selectGesture(file.path, event.modifiers, false)
          if (event.key === 'enter') void run(() => openFile(file.path))
          if (event.key === 'backspace' || event.key === 'delete') void run(() => removeFiles(selection.current.includes(file.path) ? selection.current : [file.path]))
        }}
        style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, paddingTop: 16, paddingBottom: 16, paddingLeft: 12, paddingRight: 12, borderBottomWidth: 1, borderColor: C.line, backgroundColor: selected.includes(file.path) ? C.hover : C.bg, gap: 8, cursor: 'grab', userSelect: 'none' }}>
        <Row style={{ justifyContent: 'space-between' }}><Text size={14}>{file.name}</Text><Text muted size={11}>{file.exists ? file.kind ?? 'File' : 'Missing file'}</Text></Row>
        <Text muted size={11}>{file.path}</Text>
      </div>)}
    </div>
    {selected.length > 0 ? <Row style={{ flexWrap: 'wrap', flexShrink: 0 }}>
      <Button id="files-open" disabled={busy} onClick={() => void run(async () => { let result: ShelfFile[] = []; for (const path of selection.current) result = await openFile(path); return result })}>Open</Button>
      <Button disabled={busy} onClick={() => void run(() => copyFiles(selection.current))}>Copy</Button>
      <Button disabled={busy} onClick={() => void run(() => revealFiles(selection.current))}>Show in Finder</Button>
      <Button disabled={busy} onClick={() => void run(() => removeFiles(selection.current))}>Remove</Button>
    </Row> : null}
  </>
  return <TabbedPage id="files" title="Files" compact={compact} items={tabs.Files} tab={tab} onTab={setTab} scroll={tab !== 'Shelf' && !compact} actions={compact ? undefined : tab === 'Shelf' ? <Row>
      <Button id="files-paste" disabled={busy} onClick={() => void run(pasteFiles)}>Paste files</Button>
      <Button id="files-add" primary disabled={busy} onClick={() => void run(chooseFiles)}>Add files</Button>
    </Row> : undefined}>
    {tab === 'Settings' && !compact ? <><ErrorText message={error} />{settings}</> : shelfContent}
  </TabbedPage>
}
