import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { focus } from './focus'
import { focusService } from './focus-state'
import { speech, useSpeech } from './speech-state'
import { copyText } from './platform'
import type { CompactMode } from './panel'
import { Button, C, display, ErrorText, Row, Text } from './ui'
import { clock, nextPhase, phaseTitle } from './notchflow'

export function CompactView({ mode, onExpand }: { mode: CompactMode; onExpand: () => void }) {
  return mode === 'focus' ? <CompactFocus onExpand={onExpand} /> : <CompactTalk onExpand={onExpand} />
}

function CompactFocus({ onExpand }: { onExpand: () => void }) {
  const { data, error, alertError } = useSyncExternalStore(focusService.subscribe, focusService.getSnapshot)
  const [pending, setPending] = useState(false)
  const actionPending = useRef(false)
  useEffect(() => { focusService.start() }, [])
  async function toggle() {
    if (actionPending.current || !data) return
    actionPending.current = true
    setPending(true)
    try { await focusService.run(() => focus.timer(data.isRunning ? 'pause' : 'start')) }
    catch {}
    finally { actionPending.current = false; setPending(false) }
  }
  const seconds = Math.max(0, Math.ceil(data?.remainingSeconds ?? 0))
  const time = data ? clock(seconds) : '-:--'
  const task = data?.tasks.find(item => item.id === data.selectedTaskID)
  const label = !data ? 'Loading timer' : `${phaseTitle(data.activePhase)} · ${data.activePhase === 'work' ? task?.title ?? 'Inbox' : `next ${phaseTitle(nextPhase(data)).toLowerCase()}`}`
  return <div testId="compact-focus" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: 12, gap: 8, backgroundColor: C.bg, overflowY: 'scroll' }}>
    <Row style={{ justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
      <text testId="compact-focus-clock" style={{ fontFamily: display, fontSize: 40, fontWeight: 700, color: C.text }}>{time}</text>
      <Row style={{ gap: 8 }}><Button id="compact-focus-toggle" primary disabled={!data || pending} onClick={() => void toggle()}>{data?.isRunning ? 'Pause' : 'Start'}</Button><Button id="compact-expand" onClick={onExpand}>Expand</Button></Row>
    </Row>
    <Text muted size={11}>{label}</Text>
    <ErrorText message={error || alertError} />
  </div>
}

function CompactTalk({ onExpand }: { onExpand: () => void }) {
  const state = useSpeech('talk')
  const [pending, setPending] = useState(false)
  const actionPending = useRef(false)
  const recording = state.phase === 'recording'
  const busy = !['idle', 'recording', 'success', 'failed'].includes(state.phase)
  async function act(action: () => Promise<unknown>) {
    if (actionPending.current) return
    actionPending.current = true
    setPending(true)
    try { await state.run(action) }
    finally { actionPending.current = false; setPending(false) }
  }
  const label = !state.status ? 'Loading recorder' : recording ? 'Listening'
    : state.phase === 'requestingPermission' ? 'Microphone permission needed'
    : state.phase === 'transcribing' ? 'Transcribing audio'
    : state.phase === 'formatting' ? 'Formatting text'
    : state.phase === 'inserting' ? 'Inserting text'
    : state.status.keyConfigured ? 'Ready to dictate' : 'OpenRouter key required'
  return <div testId="compact-talk" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: 12, gap: 12, backgroundColor: C.bg, overflowY: 'scroll' }}>
    <Row style={{ justifyContent: 'space-between', gap: 8, flexShrink: 0 }}><Text size={14}>{label}</Text><Button id="compact-expand" onClick={onExpand}>Expand</Button></Row>
    {recording ? <div style={{ width: '100%', height: 4, flexShrink: 0, backgroundColor: C.line }}><div style={{ height: 4, width: `${Math.min(100, Math.max(0, state.level * 100))}%`, backgroundColor: C.accent }} /></div> : null}
    <Row style={{ gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
      <Button id="compact-talk-record" primary disabled={pending || busy || !state.status || (!recording && !state.status.keyConfigured)} onClick={() => void act(() => recording ? speech().stop() : speech().start())}>{recording ? 'Stop' : 'Record'}</Button>
      {recording || busy ? <Button id="compact-talk-cancel" disabled={state.phase === 'inserting'} onClick={() => void state.run(() => speech().cancel())}>Cancel</Button> : null}
      {state.status?.canRetry ? <Button id="compact-talk-retry" disabled={pending || busy || recording} onClick={() => void act(() => speech().retry())}>Retry</Button> : null}
      {state.text ? <Button id="compact-talk-copy" onClick={() => copyText(state.text)}>Copy text</Button> : null}
    </Row>
    <ErrorText message={state.error} />
  </div>
}
