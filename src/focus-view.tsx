import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useWindowSize } from '@gpuix/react'
import { requestCompact } from './panel'
import { focus, focusClient, type FocusSettings, type FocusSnapshot, type FocusTask } from './focus'
import { focusService } from './focus-state'
import { openSettingsPane, windowKey } from './platform'
import { tabs, useTab } from './nav'
import { surfaces, useSurfaces } from './surfaces'
import { ActivityGraph, CheckInButton, CheckInPopover, Ducks, TaskEditor, TaskPanel, TimerSection, editEditor, moods, newEditor, runFocus, type EditorState } from './notchflow'
import { Button, C, Check, Column, Empty, ErrorText, Group, Intro, Row, Setting, TabbedPage, Text, space } from './ui'

// Ducks only swim while you are looking at BuddyMac. Each animation frame redraws the window.
function useWindowFocused() {
  const [focused, setFocused] = useState(() => process.env.GPUIX_BACKGROUND === '1' || windowKey())
  useEffect(() => { if (process.env.GPUIX_BACKGROUND === '1') return; const timer = setInterval(() => setFocused(windowKey()), 500); return () => clearInterval(timer) }, [])
  return focused
}
const dateLabel = (date: string) => new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const dateTime = (date: string) => new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function FocusView({ visible = true }: { visible?: boolean }) {
  const { data, error, alertError } = useSyncExternalStore(focusService.subscribe, focusService.getSnapshot)
  const [tab, setTab] = useTab('Focus')
  const [localError, setLocalError] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null), [checkIn, setCheckIn] = useState(false)
  const size = useWindowSize()
  const focused = useWindowFocused()
  const contentWidth = Math.max(300, size.width - 182 - space.page * 2)
  const openEditor = useCallback((task: FocusTask) => setEditor(editEditor(task)), [])
  const openNew = useCallback((title: string) => setEditor(newEditor(title)), [])
  useEffect(() => { focusService.start() }, [])
  async function run(work: () => Promise<FocusSnapshot>) { try { setLocalError(''); return await focusService.run(work) } catch { return null } }
  const actions = <Row>
    {data ? <CheckInButton data={data} onOpen={() => setCheckIn(true)} /> : null}
    <Button id="focus-compact" onClick={() => requestCompact('focus')}>Compact timer</Button>
  </Row>
  return <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%' }}>
    <TabbedPage id="focus" title="Focus" items={tabs.Focus} tab={tab} onTab={setTab} actions={actions} scroll={tab !== 'Tasks'}>
      <ErrorText message={localError || error || alertError} />
      {tab === 'Tasks' && data ? <>
        <Row style={{ alignItems: 'flex-start', gap: space.gap, flexGrow: 1, minHeight: 0 }}>
          <TaskPanel tasks={data.tasks} selected={data.selectedTaskID} run={runFocus} onEdit={openEditor} onNew={openNew} />
          <div style={{ width: 360, flexShrink: 0 }}><TimerSection data={data} run={run} /></div>
        </Row>
        <div style={{ height: 1, backgroundColor: C.line, flexShrink: 0 }} />
        <ActivityGraph sessions={data.sessionHistory} width={contentWidth} />
        <Ducks active={visible && tab === 'Tasks' && focused} width={contentWidth} />
      </> : null}
      {tab === 'History' && data ? <HistoryTab data={data} width={contentWidth} /> : null}
      {tab === 'Check-ins' && data ? <CheckInsTab data={data} onCheckIn={() => setCheckIn(true)} /> : null}
      {tab === 'Settings' && data ? <SettingsTab settings={data.settings} run={run} /> : null}
    </TabbedPage>
    {editor && data ? <TaskEditor value={editor} onChange={update => setEditor(current => current && update(current))} onClose={() => setEditor(null)} run={run} data={data} /> : null}
    {checkIn && data ? <div style={{ position: 'absolute', top: space.page + space.header + 8, right: space.page }}><CheckInPopover data={data} run={run} onClose={() => setCheckIn(false)} /></div> : null}
  </div>
}

function HistoryTab({ data, width }: { data: FocusSnapshot; width: number }) {
  const sessions = data.sessionHistory.filter(session => session.phase === 'work').sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
  return <>
    <ActivityGraph sessions={data.sessionHistory} width={width} />
    <Column style={{ gap: 0 }}>{sessions.length ? sessions.map(session => <Row key={session.id} style={{ flexShrink: 0, paddingTop: 12, paddingBottom: 12, paddingLeft: space.inset, paddingRight: space.inset, borderBottomWidth: 1, borderColor: C.line }}><Column style={{ flexGrow: 1, gap: 6 }}><Text>{session.taskTitle || 'Inbox'}</Text><Text muted size={11}>{dateTime(session.finishedAt)}</Text></Column><Text>{`${Math.round(session.durationSeconds / 60)} min`}</Text></Row>) : <Empty>Completed focus sessions appear here.</Empty>}</Column>
  </>
}

function CheckInsTab({ data, onCheckIn }: { data: FocusSnapshot; onCheckIn: () => void }) {
  const entries = [...data.checkIns].sort((a, b) => Date.parse(b.day) - Date.parse(a.day))
  return <>
    <Intro text="How today went and one thing you're grateful for."><Button id="focus-checkin" primary onClick={onCheckIn}>Check in</Button></Intro>
    <Column style={{ gap: 0 }}>{entries.length ? entries.map(entry => <Row key={entry.id} style={{ flexShrink: 0, alignItems: 'flex-start', paddingTop: 12, paddingBottom: 12, paddingLeft: space.inset, borderBottomWidth: 1, borderColor: C.line }}>
      <div style={{ width: 44, flexShrink: 0 }}><Text size={15}>{moods[entry.mood - 1]?.symbol ?? ':|'}</Text></div>
      <Column style={{ flexGrow: 1, gap: 6 }}><Text>{`${dateLabel(entry.day)} · ${moods[entry.mood - 1]?.title ?? ''}`}</Text>{entry.text ? <Text muted>{entry.text}</Text> : null}</Column>
    </Row>) : <Empty>No check-ins yet.</Empty>}</Column>
  </>
}

function Stepper({ id, label, value, min, max, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; unit: (value: number) => string; onChange: (value: number) => void }) {
  return <Setting label={label}><Row style={{ gap: 0 }}>
    <Button id={`${id}-down`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</Button>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 180, height: space.control }}><Text>{unit(value)}</Text></div>
    <Button id={`${id}-up`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</Button>
  </Row></Setting>
}

function SettingsTab({ settings, run }: { settings: FocusSettings; run: (work: () => Promise<FocusSnapshot>) => Promise<FocusSnapshot | null> }) {
  const layout = useSurfaces()
  const [info, setInfo] = useState(focusClient.info), [moving, setMoving] = useState(false)
  useEffect(() => { const timer = setInterval(() => setInfo(focusClient.info), 1000); return () => clearInterval(timer) }, [])
  const apply = (next: FocusSettings) => run(async () => {
    if (next.notificationsEnabled && !settings.notificationsEnabled) await focus.notificationPermission()
    return focus.updateSettings(next)
  }).then(result => { if (result) focusService.clearAlertError() })
  const minutes = (value: number) => `${value} min`
  return <>
    <Group title="Session lengths">
      <Stepper id="focus-work" label="Work" value={settings.workDurationMinutes} min={10} max={90} unit={minutes} onChange={workDurationMinutes => void apply({ ...settings, workDurationMinutes })} />
      <Stepper id="focus-short" label="Short break" value={settings.shortBreakMinutes} min={3} max={30} unit={minutes} onChange={shortBreakMinutes => void apply({ ...settings, shortBreakMinutes })} />
      <Stepper id="focus-long" label="Long break" value={settings.longBreakMinutes} min={10} max={45} unit={minutes} onChange={longBreakMinutes => void apply({ ...settings, longBreakMinutes })} />
    </Group>
    <Group title="Rhythm">
      <Stepper id="focus-cadence" label="Long break cadence" value={settings.longBreakEvery} min={2} max={6} unit={value => `Every ${value} focus sessions`} onChange={longBreakEvery => void apply({ ...settings, longBreakEvery })} />
    </Group>
    <Group title="Transitions">
      <Setting label="Notifications"><Check id="focus-notifications" label={settings.notificationsEnabled ? 'On' : 'Off'} checked={settings.notificationsEnabled} onChange={notificationsEnabled => void apply({ ...settings, notificationsEnabled })} /></Setting>
      <Setting label="Play a sound on transitions"><Check id="focus-sound" label={settings.playSoundOnTransitions ? 'On' : 'Off'} checked={settings.playSoundOnTransitions} onChange={playSoundOnTransitions => void apply({ ...settings, playSoundOnTransitions })} /></Setting>
      <Setting label="Start the next phase automatically"><Check id="focus-autostart" label={settings.autoStartNextPhase ? 'On' : 'Off'} checked={settings.autoStartNextPhase} onChange={autoStartNextPhase => void apply({ ...settings, autoStartNextPhase })} /></Setting>
      <Setting label="Notification permission" detail="Ask macOS again, or change it in System Settings."><Button onClick={() => void run(() => focus.notificationPermission())}>Ask again</Button><Button onClick={() => openSettingsPane('notifications')}>Open settings</Button></Setting>
    </Group>
    <Group title="Notch and menu bar">
      <Setting label="Open the panel when you hover the notch" detail="Move away to hide it."><Check id="focus-notch" label={layout.focusNotch ? 'On' : 'Off'} checked={layout.focusNotch} onChange={focusNotch => void surfaces.update(current => ({ ...current, focusNotch }))} /></Setting>
      <Setting label="Show the timer in the menu bar" detail="Phase and time left, next to the BuddyMac icon."><Check id="focus-menu-bar" label={layout.focusMenuBar ? 'On' : 'Off'} checked={layout.focusMenuBar} onChange={focusMenuBar => void surfaces.update(current => ({ ...current, focusMenuBar }))} /></Setting>
    </Group>
    <Group title="Sync">
      <Setting label="NotchFlow data" detail={info?.shared ? 'BuddyMac uses the same tasks, sessions and check-ins as NotchFlow and its command-line tool.' : 'BuddyMac keeps a separate copy. Switch to share one set of data with NotchFlow, its command-line tool and the phone app. A backup is made first.'}>
        {info?.shared ? null : <Button id="focus-use-notchflow" disabled={moving} onClick={() => { setMoving(true); void run(() => focus.useNotchFlowStore()).finally(() => setMoving(false)) }}>{moving ? 'Switching' : 'Share with NotchFlow'}</Button>}
      </Setting>
      <Setting label="iCloud" detail={info?.cloudKit ? 'On. Syncs with the NotchFlow phone app through your iCloud account.' : info?.shared ? 'Off. This build has no iCloud access.' : 'Turns on after sharing with NotchFlow.'} />
    </Group>
  </>
}
