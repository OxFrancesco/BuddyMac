import { useEffect, useState } from 'react'
import { currentMenuBarState, onMenuBarMoved, toggleMenuBarIcons } from './menubar'
import { autoHideChoices, surfaces, useSurfaces, type MenuBarSettings } from './surfaces'
import { accessibilityAllowed, menuBarLayout, moveMenuBarIcon, openSettingsPane, resetMenuBar, scanMenuBar, type MenuBarIcon, type MenuBarLayout, type MenuBarState } from './platform'
import { tabs, useTab } from './nav'
import { Button, C, Check, Choice, Empty, ErrorText, Group, Intro, Row, Setting, TabbedPage, Text, space } from './ui'

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)
const autoHideLabel = (seconds: number) => seconds === 0 ? 'Never' : seconds < 60 ? `${seconds} seconds` : '1 minute'
const saveMenuBar = (change: Partial<MenuBarSettings>) => surfaces.update(current => ({ ...current, menuBar: { ...current.menuBar, ...change } }))

export function MenuBarView() {
  const [tab, setTab] = useTab('Menu Bar')
  const { menuBar } = useSurfaces()
  const [state, setState] = useState<MenuBarState>(() => currentMenuBarState())
  const [error, setError] = useState('')
  // The arrow is clicked in the menu bar, outside this view, so its state is read back while the page is open.
  useEffect(() => {
    if (!menuBar.enabled) { setState(-1); return }
    const read = () => setState(currentMenuBarState())
    read()
    const timer = setInterval(read, 500)
    return () => clearInterval(timer)
  }, [menuBar.enabled])
  const toggle = () => { setError(''); try { setState(toggleMenuBarIcons()) } catch (cause) { setError(message(cause)) } }
  return <TabbedPage id="menubar" title="Menu Bar" items={tabs['Menu Bar']} tab={tab} onTab={setTab} actions={menuBar.enabled ? <Button id="menubar-toggle" primary onClick={toggle}>{state === 1 ? 'Show icons' : 'Hide icons'}</Button> : null}>
    <ErrorText message={error} />
    {tab === 'Layout' ? <Layout enabled={menuBar.enabled} onError={setError} /> : <MenuBarSettingsView state={state} onError={setError} />}
  </TabbedPage>
}

function Layout({ enabled, onError }: { enabled: boolean; onError: (message: string) => void }) {
  const [layout, setLayout] = useState<MenuBarLayout>(() => menuBarLayout())
  const [notice, setNotice] = useState('')
  const [moving, setMoving] = useState('')
  // A full read of every app takes a few seconds, so it runs when the tab opens and after changes, not continuously.
  // The cheap snapshot is polled so the list fills in as soon as the native read finishes.
  useEffect(() => {
    if (!enabled) return
    scanMenuBar()
    const timer = setInterval(() => setLayout(menuBarLayout()), 500)
    return () => clearInterval(timer)
  }, [enabled])
  useEffect(() => onMenuBarMoved(result => {
    setMoving('')
    setNotice(result.ok ? '' : result.message)
    setLayout(menuBarLayout())
  }), [])
  if (!enabled) return <>
    <Intro text="Choose which menu bar icons stay visible and which hide behind BuddyMac's arrow." />
    <Setting label="Hidden icons are off" detail="Turn them on to add BuddyMac's arrow and divider to the menu bar."><Button id="menubar-layout-enable" primary onClick={() => void saveMenuBar({ enabled: true }).catch(cause => onError(message(cause)))}>Turn on</Button></Setting>
  </>
  if (!layout.trusted) return <>
    <Intro text="Choose which menu bar icons stay visible and which hide behind BuddyMac's arrow." />
    <Setting label="Accessibility" detail="BuddyMac needs Accessibility to list other apps' menu bar icons and move them for you. Hiding and showing work without it.">
      <Button id="menubar-allow-accessibility" primary onClick={() => { accessibilityAllowed(true); setLayout(menuBarLayout()) }}>Allow</Button>
      <Button onClick={() => openSettingsPane('accessibility')}>Open settings</Button>
    </Setting>
  </>
  const move = (icon: MenuBarIcon) => {
    onError(''); setNotice('')
    const started = moveMenuBarIcon(icon.key, !icon.hidden)
    if (started === 1) { setMoving(icon.key); return }
    setNotice(started === 0 ? 'Another icon is still moving.' : started === -2 ? 'Allow Accessibility to move icons.' : 'Turn on hidden icons first.')
  }
  const reset = () => {
    onError(''); setNotice('')
    try { resetMenuBar(); setTimeout(scanMenuBar, 3000) } catch (cause) { onError(message(cause)) }
  }
  const shown = layout.items.filter(icon => !icon.hidden), hidden = layout.items.filter(icon => icon.hidden)
  const busy = layout.moving || !!moving
  const row = (icon: MenuBarIcon) => <div key={icon.key} testId={`menubar-icon-${icon.key}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: space.inset, flexShrink: 0, minHeight: space.control + 16, paddingTop: 8, paddingBottom: 8, paddingLeft: space.inset, borderBottomWidth: 1, borderColor: C.line }}>
    {icon.icon ? <img src={icon.icon} objectFit="contain" style={{ width: 24, height: 24, flexShrink: 0 }} /> : <div style={{ width: 24, height: 24, flexShrink: 0, borderWidth: 1, borderColor: C.line }} />}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 }}><Text>{icon.name}</Text><Text muted size={11}>{icon.detail}</Text></div>
    {moving === icon.key ? <Text muted>Moving</Text> : null}
    <Button id={`menubar-move-${icon.key}`} disabled={busy} onClick={() => move(icon)}>{icon.hidden ? 'Show' : 'Hide'}</Button>
  </div>
  return <>
    <Intro text="Hide or show any icon. BuddyMac shows the menu bar, then Command-drags the icon across the divider for you. The pointer moves for a moment while it does.">
      <Button id="menubar-refresh" disabled={busy || layout.scanning} onClick={() => scanMenuBar()}>{layout.scanning && !busy ? 'Reading' : 'Refresh'}</Button>
      <Button id="menubar-reset" disabled={busy} onClick={reset}>Reset layout</Button>
    </Intro>
    {notice ? <Text style={{ color: C.accent }}>{notice}</Text> : null}
    {layout.scans === 0 ? <Empty>Reading the menu bar…</Empty> : <>
      <Group title={`Always shown · ${shown.length}`}>{shown.length ? shown.map(row) : <Empty>No icons are always shown.</Empty>}</Group>
      <Group title={`Hidden behind the arrow · ${hidden.length}`}>{hidden.length ? hidden.map(row) : <Empty>No icons are hidden.</Empty>}</Group>
      <Text muted size={11}>The clock and Control Centre always stay at the right end. Reset layout puts the arrow at the right end, the BuddyMac icon beside it and every other icon on the hidden side.</Text>
    </>}
  </>
}

function MenuBarSettingsView({ state, onError }: { state: MenuBarState; onError: (message: string) => void }) {
  const { menuBar } = useSurfaces()
  const save = (change: Partial<MenuBarSettings>) => { onError(''); void saveMenuBar(change).catch(cause => onError(message(cause))) }
  return <>
    <Intro text="Icons left of the divider hide until you click the arrow at the right end of the menu bar. Hiding and showing need no permissions." />
    <Group title="Hidden icons">
      <Setting label="Hide menu bar icons" detail={!menuBar.enabled ? 'Off' : state === 1 ? 'Icons left of the divider are hidden.' : 'Icons left of the divider are shown.'}>
        <Check id="menubar-enabled" label={menuBar.enabled ? 'On' : 'Off'} checked={menuBar.enabled} onChange={enabled => save({ enabled })} />
      </Setting>
      <Setting label="Hide again after" detail="Shown icons hide by themselves. BuddyMac waits while the pointer is in the menu bar.">
        <Choice id="menubar-autohide" width={160} value={String(menuBar.autoHide)} items={autoHideChoices.map(seconds => ({ value: String(seconds), label: autoHideLabel(seconds) }))} onChange={value => save({ autoHide: Number(value) })} />
      </Setting>
      <Setting label="Hide when BuddyMac starts" detail="Starts with the icons hidden.">
        <Check id="menubar-hide-on-launch" label={menuBar.hideOnLaunch ? 'On' : 'Off'} checked={menuBar.hideOnLaunch} onChange={hideOnLaunch => save({ hideOnLaunch })} />
      </Setting>
    </Group>
    <Group title="Arrange by hand">
      <Row style={{ paddingTop: 12, flexShrink: 0 }}><Text muted size={11}>You can also hold Command and drag icons in the menu bar: left of the thin divider hides them, right of it keeps them visible. Keep the arrow right of the divider. On a Mac with a notch, hiding icons you rarely use makes room for the rest.</Text></Row>
    </Group>
  </>
}
