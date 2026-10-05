import { Profiler, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { appendFileSync } from 'node:fs'
import { render, useGpuix, useWindowSize } from '@gpuix/react'
import type { EventPayload } from '@gpuix/native'
import { CompactView } from './compact-view'
import { getPanelMode, hidePanel, presentPanel, requestCompact, restorePanel, setPanelMode, setFilesEdge, setSidebarEdge, subscribeCompact, type PanelMode } from './panel'
import { FilesView } from './files-view'
import { LinySidebar, LinyView, captureScreen, type Image } from './liny-view'
import { liny } from './liny'
import { TalkView } from './talk-view'
import { WriteView } from './write-view'
import { DockView } from './dock-view'
import { SettingsView } from './settings-view'
import { closeSpeech, speech } from './speech-state'
import { restoreSpeechShortcuts } from './speech-shortcuts'
import { FocusView } from './focus-view'
import { focusService, startFocusService, stopFocusService } from './focus-state'
import { focus } from './focus'
import { FocusPanel, clock, notchPin, phaseTitle } from './notchflow'
import { C, display, space, Text, ErrorText, Button } from './ui'
import { hideWindow, showWindow, windowKey, initializePlatform, installMenu, keepRunning, nextPlatformAction, pointerState, registerHotkeys, setStatusTitle, windowVisible, type PointerState } from './platform'
import { removeFiles } from './files'
import { dockFailureMessage, reapplyManaged, refreshDock } from './dock'
import { DockRecovery, needsAppManagement } from './dock-recovery'
import { configureEdge, edgePresented, getEdgeState, getFilesEdge, loadEdgeSettings, setEdgeFilesActive } from './edge'
import { isSection, nav, sections, useNav, type Section } from './nav'
import { Palette, paletteKey } from './palette'
import { takeoverFromLaunch } from './takeover'
import { handleRecorderAction } from './recorder'
import { surfaces, useSurfaces, type SurfaceSettings } from './surfaces'
initializePlatform()

type Surface = 'main' | 'hidden' | 'files' | 'focus' | 'talk' | 'liny' | 'notch'
const mainSections = sections.filter(section => section !== 'Settings')
function Panel({ section, pending, onPendingUsed, shown }: { section: Section; pending: Image | null; onPendingUsed: () => void; shown: boolean }) {
  switch (section) {
    case 'Files': return <FilesView />
    case 'Focus': return <FocusView visible={shown} />
    case 'Talk': return <TalkView />
    case 'Write': return <WriteView />
    case 'Dock': return <DockView />
    case 'Liny': return <LinyView pending={pending} onPendingUsed={onPendingUsed} />
    case 'Settings': return <SettingsView />
  }
}

const windowKeys = new Set<(event: EventPayload) => void>()
function onWindowKey(event: EventPayload) { for (const listener of windowKeys) listener(event) }

function inRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) { return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height }
function linyZone(pointer: PointerState, layout: SurfaceSettings['linySidebar']) {
  return pointer.screens.some(screen => {
    if (pointer.y < screen.y || pointer.y >= screen.y + screen.height) return false
    const edgeX = layout.edge === 'left' ? screen.x : screen.x + screen.width
    if (Math.abs(pointer.x - edgeX) > 28 || pointer.x < screen.x || pointer.x >= screen.x + screen.width) return false
    const fraction = (pointer.y - screen.y) / screen.height
    return layout.zone === 'entireEdge' || (layout.zone === 'bottom' ? fraction < 1 / 3 : layout.zone === 'middle' ? fraction >= 1 / 3 && fraction < 2 / 3 : fraction >= 2 / 3)
  })
}
function linyCloseArea(pointer: PointerState, edge: 'left' | 'right') {
  const window = pointer.window
  if (!window.visible || window.x === undefined || window.width === undefined) return false
  const screen = pointer.screens.find(item => inRect(pointer, item))
  if (!screen) return false
  return edge === 'right' ? pointer.x < window.x : pointer.x >= window.x + window.width
}
// NotchFlow's hotspot: a band under the menu bar centre, 18% of the display wide (190 to 300 points).
function notchZone(pointer: PointerState) {
  return pointer.screens.some(screen => {
    if (!inRect(pointer, screen)) return false
    const menuBar = Math.max(screen.y + screen.height - screen.visibleTop, 28)
    const width = Math.min(Math.max(screen.width * 0.18, 190), 300)
    return pointer.y >= screen.y + screen.height - menuBar - 18 && pointer.y <= screen.y + screen.height && Math.abs(pointer.x - (screen.x + screen.width / 2)) <= width / 2
  })
}
function outsideWindow(pointer: PointerState, margin: number) {
  const window = pointer.window
  if (!window.visible || window.x === undefined || window.y === undefined || window.width === undefined || window.height === undefined) return true
  return !inRect(pointer, { x: window.x - margin, y: window.y - margin, width: window.width + margin * 2, height: window.height + margin * 2 })
}

function App() {
  const { section, paletteOpen } = useNav()
  const layout = useSurfaces()
  const [surface, setSurface] = useState<Surface>(process.env.GPUIX_BACKGROUND === '1' ? 'main' : 'hidden')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Image | null>(null)
  const { renderer } = useGpuix()
  const surfaceRef = useRef<Surface>(surface), layoutRef = useRef(layout)
  surfaceRef.current = surface; layoutRef.current = layout
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
  const size = useWindowSize()


  function change(next: Surface) {
    const current = surfaceRef.current
    if (current === next) return
    traceSurface(`${current} -> ${next}`)
    // The notch panel and the Liny sidebar borrow the one window. Remember what to give it back to.
    if (next === 'notch' || next === 'liny' || next === 'files') {
      if (current === 'main' || current === 'hidden') { floatingReturn = current; floatingFront = current === 'main' && windowKey() }
    }
    try {
      const floating: PanelMode | null = next === 'focus' || next === 'talk' || next === 'liny' || next === 'notch' || next === 'files' ? next : null
      if (next !== 'files') setEdgeFilesActive(false)
      if (floating) {
        if (floating === 'liny') setSidebarEdge(layoutRef.current.linySidebar.edge)
        if (floating === 'files') setFilesEdge(getFilesEdge())
        setPanelMode(floating)
        if (floating === 'liny') renderer?.activateWindow?.()
      } else if (next === 'main') {
        if (getPanelMode() !== 'normal') setPanelMode('normal')
        renderer?.activateWindow?.()
      } else if (next === 'hidden') {
        if (getPanelMode() !== 'normal') hidePanel(); else hideWindow()
      }
      surfaceRef.current = next
      setSurface(next)
      if (next === 'hidden' || next === 'files' || next === 'main') setEdgeFilesActive(true)
    } catch (cause) { report(cause) }
  }
  const openMain = (target?: Section) => { if (target) nav.go(target); if (surfaceRef.current === 'main') showWindow(); change('main') }
  function dismissFloating() {
    traceSurface(`dismiss ${surfaceRef.current} to ${floatingReturn}`)
    if (floatingReturn !== 'main') { change('hidden'); return }
    try { restorePanel(floatingFront); surfaceRef.current = 'main'; setSurface('main'); setEdgeFilesActive(true) } catch (cause) { report(cause) }
  }

  useEffect(() => {
    if (surface === 'hidden') return
    // Let GPUI paint the new content at its final size before revealing the window.
    const timer = setTimeout(() => {
      presentPanel()
      if (surface === 'main' && process.env.GPUIX_BACKGROUND !== '1') showWindow()
      if (surface === 'files') edgePresented()
    }, 50)
    return () => clearTimeout(timer)
  }, [surface, size.width, size.height])

  async function captureForLiny() {
    try {
      const shot = await captureScreen(true)
      if (!shot) return
      setPending(shot)
      if (layoutRef.current.linySidebar.enabled && surfaceRef.current !== 'main') change('liny'); else openMain('Liny')
    } catch (cause) { report(cause) }
  }

  useEffect(() => subscribeCompact(mode => {
    if (mode === 'normal') change('main')
    else change(mode)
  }), [renderer])

  useEffect(() => {
    const failed = registerHotkeys([
      ...layout.linyShortcuts.open ? [{ id: 'liny-open', keyCode: layout.linyShortcuts.open.keyCode, modifiers: layout.linyShortcuts.open.modifiers }] : [],
      ...layout.linyShortcuts.capture ? [{ id: 'liny-capture', keyCode: layout.linyShortcuts.capture.keyCode, modifiers: layout.linyShortcuts.capture.modifiers }] : [],
    ])
    if (failed.length) setError(`Another app already uses the ${failed.map(id => id === 'liny-open' ? 'Open Liny' : 'Capture region').join(' and ')} shortcut. Change it in Liny settings.`)
  }, [layout.linyShortcuts])


  useEffect(() => {
    const listener = (event: EventPayload) => {
      const cmd = !!event.modifiers?.cmd && !event.modifiers.ctrl && !event.modifiers.alt
      if (nav.get().paletteOpen && event.key && paletteKey(event.key)) return
      if (cmd && event.key === 'k') { nav.palette(!nav.get().paletteOpen); return }
      if (cmd && event.key && /^[1-7]$/.test(event.key)) { const target = sections[Number(event.key) - 1]; if (target && surfaceRef.current === 'main') nav.go(target); return }
      if (event.key === 'escape' && !event.modifiers?.cmd && (surfaceRef.current === 'liny' || (surfaceRef.current === 'notch' && !notchPin.pinned))) dismissFloating()
    }
    windowKeys.add(listener)
    return () => { windowKeys.delete(listener) }
  }, [renderer])

  useEffect(() => {
    startFocusService()
    void surfaces.load().catch(report)
    void restoreSpeechShortcuts().catch(report)
    if (process.env.GPUIX_BACKGROUND !== '1') { installMenu(); keepRunning() }
    else if (process.env.BUDDYMAC_VERIFY_SURFACES === '1') keepRunning()
    void loadEdgeSettings().then(settings => { setEdgeFilesActive(true); configureEdge(settings) }).catch(report)
    if (process.argv.includes('--takeover')) void takeoverFromLaunch().then(async problems => { if (problems.length) report(problems.join(' ')); await loadEdgeSettings().then(configureEdge); await surfaces.load() }).catch(report)
    let linySince = 0, linyArmed = true, closeSince = 0, notchSince = 0, leaveSince = 0
    if (process.env.GPUIX_BACKGROUND !== '1') try { speech() } catch (cause) { report(cause) }
    const timer = setInterval(() => {
      const action = nextPlatformAction()
      if (isSection(action)) openMain(action)
      else if (action === 'focus-toggle') { const running = focusService.getSnapshot().data?.isRunning; void focusService.run(() => focus.timer(running ? 'pause' : 'start')).catch(report) }
      else if (action === 'focus-skip') void focusService.run(() => focus.timer('skip')).catch(report)
      else if (action === 'focus-panel') { notchArmed = false; change('notch') }
      else if (action === 'quit') { stopFocusService(); closeSpeech(); liny.close(); process.exit(0) }
      else if (action.startsWith('{')) {
        try {
          const value: unknown = JSON.parse(action)
          if (value && typeof value === 'object') {
            const record = value as Record<string, unknown>
            if (handleRecorderAction(record)) {}
            else if (record.action === 'hotkey' && record.id === 'liny-open') {
              if (surfaceRef.current === 'liny') dismissFloating()
              else if (layoutRef.current.linySidebar.enabled) { linyArmed = false; change('liny') }
              else openMain('Liny')
            } else if (record.action === 'hotkey' && record.id === 'liny-capture') void captureForLiny()
            else if (record.action === 'files-drag-completed' && Array.isArray(record.paths) && record.paths.every((path: unknown) => typeof path === 'string')) void removeFiles(record.paths as string[]).catch(report)
          }
        } catch (cause) { report(cause) }
      }
      const now = Date.now(), current = surfaceRef.current, settings = layoutRef.current
      if (process.env.GPUIX_BACKGROUND === '1' && process.env.BUDDYMAC_VERIFY_SURFACES !== '1') return
      const visible = windowVisible(), edge = getEdgeState()
      if (current === 'main' && !visible) { traceSurface('main -> hidden (window closed)'); surfaceRef.current = 'hidden'; setSurface('hidden'); setEdgeFilesActive(true); return }
      if (current === 'files' && !edge.revealed && !edge.requested) { dismissFloating(); return }
      if ((current === 'hidden' || current === 'main') && edge.requested) { change('files'); return }
      if (current === 'hidden' && visible && !edge.active) { traceSurface('hidden -> main (window reappeared)'); surfaceRef.current = 'main'; setSurface('main'); return }
      const watchMain = current === 'main' && (settings.focusNotch || settings.linySidebar.enabled)
      const pointer = current === 'hidden' || current === 'liny' || current === 'notch' || watchMain ? pointerState() : null
      // With the window open, the edges still work as long as the pointer is not over BuddyMac itself.
      if (pointer && (current === 'hidden' || current === 'main') && !pointer.down) {
        if (settings.linySidebar.enabled && outsideWindow(pointer, 0) && linyZone(pointer, settings.linySidebar)) { if (!linySince) linySince = now; else if (linyArmed && now - linySince >= 350) { linySince = 0; linyArmed = false; closeSince = 0; change('liny') } }
        else { linySince = 0; linyArmed = true }
        if (settings.focusNotch && notchZone(pointer)) { if (!notchSince) notchSince = now; else if (now - notchSince >= 120) { notchSince = 0; leaveSince = 0; notchArmed = true; change('notch') } } else notchSince = 0
      }
      if (pointer && current === 'liny') {
        if (!linyArmed && !linyCloseArea(pointer, settings.linySidebar.edge)) linyArmed = true
        if (linyArmed && linyCloseArea(pointer, settings.linySidebar.edge)) { if (!closeSince) closeSince = now; else if (now - closeSince >= 350) { closeSince = 0; linyArmed = false; dismissFloating() } } else closeSince = 0
      }
      if (pointer && current === 'notch') {
        const outside = outsideWindow(pointer, 8) && !notchZone(pointer)
        if (!outside) notchArmed = true
        if (outside && notchArmed && !notchPin.pinned) { if (!leaveSince) leaveSince = now; else if (now - leaveSince >= 150) { leaveSince = 0; dismissFloating() } } else leaveSince = 0
      }
    }, 100)
    // Apps owned by root (for example Tailscale) can't take a custom icon without sudo; that is shown in Dock, not every minute here.
    const maintain = () => void reapplyManaged().then(results => { const failure = dockFailureMessage(results.filter(result => !/owned by/i.test(result.error ?? ''))); if (failure) report(failure) }).catch(report)
    const dockTimer = setInterval(maintain, 60_000)
    return () => { stopFocusService(); clearInterval(timer); clearInterval(dockTimer) }
  }, [renderer])

  // The speech helper draws the dictation pill itself, so it follows the recorder even with the window closed.
  useEffect(() => { if (process.env.GPUIX_BACKGROUND !== '1') void Promise.resolve().then(() => speech().setOverlay(layout.talkPill)).catch(report) }, [layout.talkPill])

  const floating = surface === 'focus' || surface === 'talk' || surface === 'liny' || surface === 'files' || surface === 'notch'
  return <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row', backgroundColor: C.bg }}>
    <MenuBarTimer />
    {!floating ? <Sidebar section={section} /> : null}
    <div style={{ position: 'relative', flexGrow: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
      {!floating ? <div key={section} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}><Panel section={section} shown pending={section === 'Liny' ? pending : null} onPendingUsed={() => setPending(null)} /></div> : null}
      {surface === 'focus' || surface === 'talk' ? <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}><CompactView mode={surface} onExpand={() => requestCompact('normal')} /></div> : null}
      {surface === 'liny' ? <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}><LinySidebar onExpand={() => { nav.go('Liny'); requestCompact('normal') }} pending={pending} onPendingUsed={() => setPending(null)} /></div> : null}
      {surface === 'notch' ? <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}><FocusPanel width={size.width} onExpand={() => openMain('Focus')} onSettings={() => { nav.go('Focus', 'Settings'); change('main') }} /></div> : null}
      {surface === 'files' ? <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}><FilesView shelf /></div> : null}
      {paletteOpen && !floating ? <Palette /> : null}
      {error ? <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', paddingTop: 12, paddingBottom: 12, paddingLeft: floating ? 16 : space.page, paddingRight: floating ? 16 : space.page, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg }}>
        {needsAppManagement(error) && floating ? <Button id="dock-permission-expand" onClick={() => openMain('Dock')}>Fix Dock icons</Button> : needsAppManagement(error) ? <DockRecovery error={error} onError={setError} dismiss={() => setError('')} retry={async () => {
          const results = await reapplyManaged()
          if (results.some(result => result.changed)) await refreshDock()
          const failure = dockFailureMessage(results.filter(result => !/owned by/i.test(result.error ?? '')))
          if (failure) throw new Error(failure)
        }} /> : <div onClick={() => setError('')}><ErrorText message={error} /></div>}
      </div> : null}
    </div>
  </div>
}

let notchArmed = true
const surfaceTrace = process.env.BUDDYMAC_TRACE_SURFACES
/** `BUDDYMAC_TRACE_SURFACES=/path.log` records every window-surface change with the pointer and window state. */
function traceSurface(event: string) {
  if (!surfaceTrace) return
  let state = ''
  try { const pointer = pointerState(); state = JSON.stringify({ x: Math.round(pointer.x), y: Math.round(pointer.y), window: pointer.window }) } catch {}
  appendFileSync(surfaceTrace, `${new Date().toISOString()} ${event} ${state}\n`)
}
let floatingReturn: 'main' | 'hidden' = 'hidden', floatingFront = false

/** Keeps the menu bar label in step with the timer without re-rendering the whole app every second. */
function MenuBarTimer() {
  const { data } = useSyncExternalStore(focusService.subscribe, focusService.getSnapshot)
  const { focusMenuBar } = useSurfaces()
  const title = focusMenuBar && data ? `${phaseTitle(data.activePhase)} ${clock(data.remainingSeconds)}` : ''
  useEffect(() => { setStatusTitle(title) }, [title])
  return null
}

function Sidebar({ section }: { section: Section }) {
  const item = (target: Section, label: string = target) => <div role="button" aria-label={label} tabIndex={0} key={target} testId={`nav-${target}`} onClick={() => nav.go(target)} onKeyDown={event => { if (event.key === 'enter' || event.key === 'space') nav.go(target) }} style={{ display: 'flex', flexDirection: 'row', height: 40, flexShrink: 0, paddingLeft: 13, alignItems: 'center', justifyContent: 'flex-start', borderLeftWidth: 2, borderColor: section === target ? C.accent : C.bg, backgroundColor: C.bg, hover: { backgroundColor: C.hover }, cursor: 'pointer' }}><Text size={14} style={{ color: section === target ? C.accent : C.text }}>{label}</Text></div>
  return <div style={{ display: 'flex', flexDirection: 'column', width: 182, flexShrink: 0, height: '100%', paddingTop: space.page, paddingBottom: space.page, paddingLeft: 20, paddingRight: 20, borderRightWidth: 1, borderColor: C.line, gap: 8 }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: space.header, flexShrink: 0, paddingLeft: 15, marginBottom: space.gap - 8 }}><text style={{ color: C.text, fontFamily: display, fontSize: 23, fontWeight: 700 }}>BuddyMac</text></div>
    {mainSections.map(target => item(target))}
    <div style={{ flexGrow: 1 }} />
    <div role="button" aria-label="Search" tabIndex={0} testId="nav-search" onClick={() => nav.palette(true)} style={{ display: 'flex', flexDirection: 'row', height: 40, flexShrink: 0, paddingLeft: 15, paddingRight: 12, alignItems: 'center', justifyContent: 'space-between', hover: { backgroundColor: C.hover }, cursor: 'pointer' }}><Text size={14}>Search</Text><Text muted size={11}>⌘K</Text></div>
    {item('Settings')}
  </div>
}

const profile = process.env.BUDDYMAC_PROFILE
const commits: { at: number; ms: number }[] = []
if (profile) setInterval(() => void Bun.write(profile, JSON.stringify(commits)), 1000)
const Root = () => profile ? <Profiler id="app" onRender={(_id, _phase, actual) => { commits.push({ at: Date.now(), ms: actual }) }}><App /></Profiler> : <App />
render(<Root />, { title: 'BuddyMac', appName: 'BuddyMac', width: 1080, height: 760, minWidth: 900, minHeight: 640, focus: false, show: process.env.GPUIX_BACKGROUND === '1', onKeyDown: onWindowKey })
