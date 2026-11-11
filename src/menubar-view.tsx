import { useEffect, useState } from 'react'
import { currentMenuBarState, toggleMenuBarIcons } from './menubar'
import { autoHideChoices, surfaces, useSurfaces, type MenuBarSettings } from './surfaces'
import type { MenuBarState } from './platform'
import { Button, Check, Choice, ErrorText, Group, Intro, Section, Setting, Text } from './ui'

const autoHideLabel = (seconds: number) => seconds === 0 ? 'Never' : seconds < 60 ? `${seconds} seconds` : '1 minute'
const steps = [
  'Turn on hidden icons. A thin divider appears left of the BuddyMac icon and an arrow right of it.',
  'Click the arrow. Every icon left of the divider hides. Click it again to show them.',
  'To keep an icon visible, hold Command and drag it right of the divider. Drag one left of it to hide it.',
  'Keep the arrow right of the divider, or it hides too.',
]

export function MenuBarView() {
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
  const save = (change: Partial<MenuBarSettings>) => { setError(''); void surfaces.update(current => ({ ...current, menuBar: { ...current.menuBar, ...change } })).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))) }
  const toggle = () => { setError(''); try { setState(toggleMenuBarIcons()) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  return <Section title="Menu Bar" actions={menuBar.enabled ? <Button id="menubar-toggle" primary onClick={toggle}>{state === 1 ? 'Show icons' : 'Hide icons'}</Button> : null}>
    <Intro text="Keep the menu bar tidy. Icons left of the BuddyMac icon hide until you click the arrow next to it. No Accessibility or Screen Recording access is needed." />
    <ErrorText message={error} />
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
    <Group title="Choose which icons hide">
      {steps.map((step, index) => <Setting key={step} label={`${index + 1}. ${step}`} />)}
      <Text muted size={11} style={{ paddingTop: 12 }}>On a Mac with a notch, icons that do not fit beside it are cut off by macOS. Hiding the ones you rarely use makes room for the rest.</Text>
    </Group>
  </Section>
}
