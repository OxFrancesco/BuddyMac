import { useEffect, useState } from 'react'
import { focus, focusNotificationStatus } from './focus'
import { speech, useSpeech } from './speech-state'
import { setSpeechShortcuts } from './speech-shortcuts'
import { talkPrefs, useTalkPrefs } from './talk-prefs'
import type { WritingState } from './speech'
import { loginEnabled, nativeKeyLabel, openSettingsPane, setLogin } from './platform'
import { originalApps, originalStatuses, openOriginal, restoreOriginals, stopOriginals, takenOver, type OriginalStatus } from './originals'
import { makeBuddyMacMain } from './takeover'
import { useSurfaces } from './surfaces'
import { nav, sections, tabs, useTab, type Section } from './nav'
import { formatShortcut, fromCarbon, fromCocoa } from './shortcuts'
import { Button, Check, ErrorText, Group, Row, Setting, TabbedPage, Text } from './ui'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function SettingsView() {
  const [tab, setTab] = useTab('Settings')
  const [error, setError] = useState('')
  async function run(work: () => Promise<unknown>) { setError(''); try { await work() } catch (cause) { setError(message(cause)) } }
  return <TabbedPage id="settings" title="Settings" items={tabs.Settings} tab={tab} onTab={setTab}>
    <ErrorText message={error} />
    {tab === 'General' ? <General run={run} /> : null}
    {tab === 'Permissions' ? <Permissions run={run} /> : null}
    {tab === 'Shortcuts' ? <Shortcuts /> : null}
    {tab === 'Original apps' ? <Originals run={run} setError={setError} /> : null}
  </TabbedPage>
}

function General({ run }: { run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [atLogin, setAtLogin] = useState(loginEnabled)
  const s = useSpeech()
  const layout = useSurfaces()
  return <>
    <Group title="BuddyMac">
      <Setting label="Start at login" detail="BuddyMac opens in the menu bar when you log in."><Check id="settings-login" label={atLogin ? 'On' : 'Off'} checked={atLogin} onChange={next => void run(async () => setAtLogin(setLogin(next)))} /></Setting>
      <Setting label="Find anything" detail="Press Command K anywhere in BuddyMac to jump to a tool, a tab or an action."><Button id="settings-open-search" onClick={() => nav.palette(true)}>Open search</Button></Setting>
      <Setting label="Closing the window" detail="BuddyMac keeps running in the menu bar. Edge shelves, the Liny sidebar and shortcuts work while the window is closed." />
    </Group>
    <Group title="Always available">
      <Setting label="Files shelf at the screen edge" detail="Set the side and behaviour in Files."><Button onClick={() => nav.go('Files', 'Settings')}>Files settings</Button></Setting>
      <Setting label="Liny sidebar" detail={layout.linySidebar.enabled ? `Hover the ${layout.linySidebar.edge} edge to open it.` : 'Off'}><Button onClick={() => nav.go('Liny', 'Settings')}>Liny settings</Button></Setting>
      <Setting label="Focus timer under the notch" detail={layout.focusNotch ? 'Hover the notch to see the timer.' : 'Off'}><Button onClick={() => nav.go('Focus', 'Settings')}>Focus settings</Button></Setting>
    </Group>
    <Group title="Account">
      <Setting label="OpenRouter key" detail={s.status?.keyConfigured ? 'Saved in Keychain. Talk and Write use it.' : 'Needed for Talk and Write.'}><Button onClick={() => nav.go('Talk', 'Settings')}>Manage key</Button></Setting>
      <Setting label="Liny provider" detail="Codex, OpenRouter or Z.AI."><Button onClick={() => nav.go('Liny', 'Settings')}>Manage provider</Button></Setting>
    </Group>
  </>
}

function Permissions({ run }: { run: (work: () => Promise<unknown>) => Promise<void> }) {
  const s = useSpeech()
  const [notifications, setNotifications] = useState('')
  useEffect(() => { void focusNotificationStatus().then(value => setNotifications(value.authorizationStatus)).catch(() => setNotifications('unknown')) }, [])
  const status = (allowed: boolean | undefined) => allowed === undefined ? 'Checking' : allowed ? 'Allowed' : 'Not allowed'
  return <>
    <Setting label="Microphone" detail={`${status(s.status?.microphoneGranted)}. Talk records your voice.`}><Button onClick={() => openSettingsPane('microphone')}>Open settings</Button></Setting>
    <Setting label="Accessibility" detail={`${status(s.status?.accessibilityGranted)}. Lets Talk and Write type into other apps. Without it, text goes to the clipboard.`}>{s.status?.accessibilityGranted ? null : <Button onClick={() => void run(async () => { await speech().requestAccessibility(); await s.refresh() })}>Allow</Button>}<Button onClick={() => openSettingsPane('accessibility')}>Open settings</Button></Setting>
    <Setting label="Screen Recording" detail={`${status(s.status?.screenCaptureGranted)}. Screen context for Talk and Liny, and region capture.`}>{s.status?.screenCaptureGranted ? null : <Button onClick={() => void run(async () => { await speech().requestScreenCapture(); await s.refresh() })}>Allow</Button>}<Button onClick={() => openSettingsPane('screen')}>Open settings</Button></Setting>
    <Setting label="Notifications" detail={`${notifications === 'authorized' ? 'Allowed' : notifications === 'denied' ? 'Not allowed' : notifications ? 'Not asked yet' : 'Checking'}. Focus tells you when a phase ends.`}>{notifications === 'authorized' ? null : <Button onClick={() => void run(async () => { await focus.notificationPermission(); setNotifications((await focusNotificationStatus()).authorizationStatus) })}>Allow</Button>}<Button onClick={() => openSettingsPane('notifications')}>Open settings</Button></Setting>
    <Setting label="App Management" detail="Dock needs it to change other apps' icons."><Button onClick={() => openSettingsPane('appManagement')}>Open settings</Button></Setting>
    <Setting label="Automation" detail="Used once to turn off the original apps' login items, and by Dock to reopen apps."><Button onClick={() => openSettingsPane('automation')}>Open settings</Button></Setting>
  </>
}

function Shortcuts() {
  const prefs = useTalkPrefs()
  const layout = useSurfaces()
  const s = useSpeech()
  const [writing, setWriting] = useState<WritingState | null>(null)
  useEffect(() => { void talkPrefs.load(); void speech().writing().then(setWriting).catch(() => {}) }, [])
  const talk = prefs.saved?.shortcuts
  const talkLabel = (value?: { keyCode: number; modifiers: number; keyLabel: string }) => value ? formatShortcut(value.keyCode, fromCarbon(value.modifiers), value.keyLabel) : 'Not set'
  const cocoaLabel = (value?: { keyCode: number; modifiersRawValue?: number; modifiers?: number; label?: string } | null) => value ? formatShortcut(value.keyCode, fromCocoa(value.modifiersRawValue ?? value.modifiers ?? 0), value.label || nativeKeyLabel(value.keyCode)) : 'Not set'
  return <>
    <Setting label="Shortcuts in other apps" detail={s.status?.shortcutsEnabled ? 'On for Talk and Write.' : 'Off. Talk and Write shortcuts only work inside BuddyMac.'}><Check id="settings-shortcuts-enabled" label={s.status?.shortcutsEnabled ? 'On' : 'Off'} checked={!!s.status?.shortcutsEnabled} onChange={next => void setSpeechShortcuts(next).then(() => s.refresh())} /></Setting>
    <Group title="Talk">
      <Setting label="Hold to dictate"><Text muted>{talkLabel(talk?.hold)}</Text></Setting>
      <Setting label="Hands-free dictation"><Text muted>{talkLabel(talk?.toggle)}</Text></Setting>
      <Setting label="Edit selected text by voice"><Text muted>{talkLabel(talk?.edit)}</Text></Setting>
      <Setting label="Cancel"><Text muted>{talkLabel(talk?.cancel)}</Text></Setting>
      <Row style={{ paddingTop: 12, flexShrink: 0 }}><Button onClick={() => nav.go('Talk', 'Shortcuts')}>Change Talk shortcuts</Button></Row>
    </Group>
    <Group title="Write">
      {writing?.profiles.filter(profile => profile.hotkey).map(profile => <Setting key={profile.id} label={`Rewrite with ${profile.name}`} detail={profile.isEnabled ? undefined : 'Off'}><Text muted>{cocoaLabel(profile.hotkey)}</Text></Setting>)}
      {writing?.notes.filter(note => note.hotkey).map(note => <Setting key={note.id} label={`Paste ${note.title}`}><Text muted>{cocoaLabel(note.hotkey)}</Text></Setting>)}
      <Row style={{ paddingTop: 12, flexShrink: 0 }}><Button onClick={() => nav.go('Write', 'Profiles')}>Change Write shortcuts</Button></Row>
    </Group>
    <Group title="Liny">
      <Setting label="Open Liny"><Text muted>{cocoaLabel(layout.linyShortcuts.open)}</Text></Setting>
      <Setting label="Capture a screen region"><Text muted>{cocoaLabel(layout.linyShortcuts.capture)}</Text></Setting>
      <Row style={{ paddingTop: 12, flexShrink: 0 }}><Button onClick={() => nav.go('Liny', 'Settings')}>Change Liny shortcuts</Button></Row>
    </Group>
    <Group title="Inside BuddyMac">
      <Setting label="Search"><Text muted>Command + K</Text></Setting>
      {sections.map((section: Section, index) => <Setting key={section} label={`Go to ${section}`}><Text muted>{`Command + ${index + 1}`}</Text></Setting>)}
      <Setting label="Close the window"><Text muted>Command + W</Text></Setting>
    </Group>
  </>
}

function Originals({ run, setError }: { run: (work: () => Promise<unknown>) => Promise<void>; setError: (message: string) => void }) {
  const [statuses, setStatuses] = useState<OriginalStatus[]>([]), [main, setMain] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  async function refresh() { setStatuses(await originalStatuses()); setMain(await takenOver()) }
  useEffect(() => { void run(refresh) }, [])
  async function act(work: () => Promise<string[]>, done: string) {
    setBusy(true); setNotice('')
    try { const problems = await work(); await refresh(); if (problems.length) setError(problems.join(' ')); else setNotice(done) }
    catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  return <>
    <Setting label={main ? 'BuddyMac is your main app' : 'Make BuddyMac your main app'} detail={main ? 'The originals are closed and no longer start at login. Their data is untouched.' : 'Closes the originals, stops them starting at login, brings over their latest data and turns on BuddyMac\'s shortcuts, edge shelves and start at login.'}>
      {main ? <Button id="settings-restore-originals" disabled={busy} onClick={() => void act(restoreOriginals, 'The originals start at login again. Open them when you need them.')}>Give back to originals</Button>
        : <Button id="settings-take-over" primary disabled={busy} onClick={() => void act(makeBuddyMacMain, 'Done. BuddyMac now handles everything the originals did.')}>{busy ? 'Working' : 'Take over'}</Button>}
    </Setting>
    {notice ? <Text muted>{notice}</Text> : null}
    <Group title="Apps">
      {originalApps.map(app => { const status = statuses.find(item => item.id === app.id); return <Setting key={app.id} label={app.name} detail={!status ? 'Checking' : !status.installed ? 'Not installed' : app.bundleId ? [status.running ? 'Running' : 'Not running', status.loginItem ? 'opens at login' : ''].filter(Boolean).join(' · ') : status.agentLoaded ? 'Background agent on' : 'Background agent off'}>
        <Button onClick={() => nav.go(app.section as Section)}>{`Open ${app.section}`}</Button>
        {status?.running || status?.agentLoaded || status?.loginItem ? <Button disabled={busy} onClick={() => void act(() => stopOriginals([app.id]), `${app.name} is closed and won't start at login.`)}>Turn off</Button> : status?.installed && app.bundleId ? <Button disabled={busy} onClick={() => void run(async () => { await openOriginal(app); await refresh() })}>Open original</Button> : null}
      </Setting> })}
    </Group>
    <Setting label="Login items in System Settings" detail="Some apps register themselves there. Check that the originals are off."><Button onClick={() => openSettingsPane('loginItems')}>Open settings</Button></Setting>
  </>
}
