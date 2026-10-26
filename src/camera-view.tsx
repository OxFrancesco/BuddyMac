import { useEffect, useState } from 'react'
import { basename } from 'node:path'
import { camera, cameraAction, onCameraRecorded, toggleCameraPreview, toggleCameraRecording, useCamera, type CameraKind, type CameraMode, type CameraState, type Recording } from './camera'
import { openSettingsPane } from './platform'
import { tabs, useTab } from './nav'
import { Button, Check, Choice, Empty, ErrorText, Group, Row, Setting, TabbedPage, Text } from './ui'

const kindLabel: Record<CameraKind, string> = { usb: 'USB camera', continuity: 'iPhone camera', builtIn: 'Built-in camera', deskView: 'Desk View', other: 'Camera' }
const names: Record<string, string> = { '3840x2160': '4K', '2560x1440': '1440p', '1920x1080': '1080p', '1280x720': '720p', '640x480': 'VGA' }
const size = (mode: { width: number; height: number }) => `${mode.width}x${mode.height}`
const sizeLabel = (mode: { width: number; height: number }) => `${mode.width} × ${mode.height}${names[size(mode)] ? ` (${names[size(mode)]})` : ''}`
const fpsLabel = (fps: number) => `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`
const open = (...args: string[]) => void Bun.spawn(['/usr/bin/open', ...args]).exited
function bytes(value: number) { return value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(value / 1e6))} MB` }

export function CameraView() {
  const [tab, setTab] = useTab('Camera')
  const { state, error } = useCamera()
  return <TabbedPage id="camera" title="Camera" items={tabs.Camera} tab={tab} onTab={setTab} actions={state ? <Actions state={state} /> : null}>
    <ErrorText message={error || state?.error || ''} />
    {!state ? null : tab === 'Capture' ? <Capture state={state} /> : tab === 'Recordings' ? <Recordings state={state} /> : <CameraSettings state={state} />}
  </TabbedPage>
}

function Actions({ state }: { state: CameraState }) {
  if (!state.devices.length) return null
  return <Row>
    <Button id="camera-preview" onClick={() => void toggleCameraPreview()}>{state.preview ? 'Hide preview' : 'Show preview'}</Button>
    <Button id="camera-record" primary onClick={() => void toggleCameraRecording()}>{state.recording ? 'Stop' : 'Record'}</Button>
    {state.recording ? <Elapsed since={state.recording.startedAt} /> : null}
  </Row>
}

/** Only this re-renders every second while recording. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return <Text style={{ color: '#d6544b' }}>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</Text>
}

function Capture({ state }: { state: CameraState }) {
  if (state.authorization === 'denied' || state.authorization === 'restricted') return <Setting label="Camera access is off" detail="Allow BuddyMac in Privacy & Security › Camera, then come back."><Button onClick={() => openSettingsPane('camera')}>Open settings</Button></Setting>
  if (!state.devices.length) return <Empty>No camera connected. Plug one in over USB and it shows up here.</Empty>
  const device = state.devices.find(item => item.id === state.device)
  const current = state.modes.find(mode => mode.id === state.mode)
  const sizes = [...new Map(state.modes.map(mode => [size(mode), mode])).values()]
  const rates = state.modes.filter(mode => current && size(mode) === size(current))
  const locked = !!state.recording
  function pickSize(value: string) {
    const options = state.modes.filter(mode => size(mode) === value)
    const next = options.find(mode => mode.fps === current?.fps) ?? options[0]
    if (next) void cameraAction(client => client.configure({ mode: next.id }))
  }
  return <>
    <Group>
      <Setting label="Camera" detail={device ? kindLabel[device.kind] : undefined}>
        <Choice id="camera-device" width={300} value={state.device ?? ''} items={state.devices.map(item => ({ value: item.id, label: item.name }))} onChange={value => void cameraAction(client => client.configure({ device: value }))} />
      </Setting>
      <Setting label="Resolution" detail={locked ? 'Stop recording to change it.' : undefined}>
        <Choice id="camera-size" width={300} value={current ? size(current) : ''} items={sizes.map(mode => ({ value: size(mode), label: sizeLabel(mode) }))} onChange={pickSize} />
      </Setting>
      <Setting label="Frame rate">
        <Choice id="camera-fps" width={300} value={state.mode ?? ''} items={rates.map((mode: CameraMode) => ({ value: mode.id, label: fpsLabel(mode.fps) }))} onChange={value => void cameraAction(client => client.configure({ mode: value }))} />
      </Setting>
      <Setting label="Sound" detail={state.microphone && state.microphoneAuthorization === 'denied' ? 'Microphone access is off.' : 'Recorded with the video.'}>
        <Choice id="camera-microphone" width={300} value={state.microphone ?? ''} items={[{ value: '', label: 'No sound' }, ...state.microphones.map(item => ({ value: item.id, label: item.name }))]} onChange={value => void cameraAction(client => client.configure({ microphone: value || null }))} />
      </Setting>
      <Setting label="Mirror the preview" detail="Recordings are saved unmirrored.">
        <Check id="camera-mirror" label={state.mirror ? 'On' : 'Off'} checked={state.mirror} onChange={value => void cameraAction(client => client.configure({ mirror: value }))} />
      </Setting>
    </Group>
    {state.lastRecording ? <Setting id="camera-last" label="Last recording" detail={basename(state.lastRecording)}>
      <Button onClick={() => open(state.lastRecording!)}>Play</Button>
      <Button onClick={() => open('-R', state.lastRecording!)}>Show in Finder</Button>
    </Setting> : null}
  </>
}

function Recordings({ state }: { state: CameraState }) {
  const [items, setItems] = useState<Recording[] | null>(null)
  const refresh = () => void camera().recordings().then(setItems).catch(() => setItems([]))
  useEffect(() => { refresh(); return onCameraRecorded(refresh) }, [state.folder])
  if (!items) return null
  if (!items.length) return <Empty>No recordings yet.</Empty>
  return <Group>{items.map(item => <Setting key={item.path} id={`recording-${item.name}`} label={item.name} detail={`${bytes(item.size)} · ${new Date(item.modifiedAt).toLocaleString()}`}>
    <Button onClick={() => open(item.path)}>Play</Button>
    <Button onClick={() => open('-R', item.path)}>Show in Finder</Button>
    <Button quiet onClick={() => void camera().trash(item.path).then(setItems)}>Move to Trash</Button>
  </Setting>)}</Group>
}

function CameraSettings({ state }: { state: CameraState }) {
  const access = (value: string) => value === 'authorized' ? 'Allowed' : value === 'notDetermined' ? 'Asked the first time you preview or record' : 'Not allowed'
  return <>
    <Setting label="Video format" detail={state.codec === 'hevc' ? 'HEVC. About half the size of H.264 at the same quality.' : 'H.264. Plays in every app and browser.'}>
      <Choice id="camera-codec" value={state.codec} items={[{ value: 'hevc', label: 'HEVC' }, { value: 'h264', label: 'H.264' }]} onChange={value => void cameraAction(client => client.configure({ codec: value === 'h264' ? 'h264' : 'hevc' }))} />
    </Setting>
    <Setting label="Save recordings to" detail={state.folder}>
      <Button onClick={() => open(state.folder)}>Open</Button>
      <Button id="camera-folder" onClick={() => void cameraAction(client => client.chooseFolder())}>Change</Button>
    </Setting>
    <Setting label="Camera" detail={access(state.authorization)}><Button onClick={() => openSettingsPane('camera')}>Open settings</Button></Setting>
    <Setting label="Microphone" detail={access(state.microphoneAuthorization)}><Button onClick={() => openSettingsPane('microphone')}>Open settings</Button></Setting>
  </>
}
