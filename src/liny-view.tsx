import { useEffect, useState, useSyncExternalStore } from 'react'
import { useGpuix } from '@gpuix/react'
import { chmod, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { liny, type LinySnapshot, type LinyState, type LinySources, type LinySessions, type LinyProvider, type LinyThinking } from './liny'
import { submitLinyMessage } from './liny-submission'
import { useSticky } from './sticky'
import { profilePaths } from '../native/liny/storage'
import { openSettingsPane, promptSecret } from './platform'
import { tabs, useTab } from './nav'
import { surfaces, useSurfaces, type StoredShortcut } from './surfaces'
import { formatShortcut, fromCocoa, hasModifier, toCocoa, type RecordedShortcut } from './shortcuts'
import { Button, C, Check, Choice, Column, Empty, ErrorText, Field, Group, Header, Intro, Page, Row, Setting, ShortcutField, TabbedPage, Text, font, markdownTheme, space } from './ui'

export type Image = { name: string; data: string; mimeType: string }
const commands = [['/new', 'Start a new conversation'], ['/remember ', 'Save a fact to today\'s memory note'], ['/memory', 'Show what Liny remembers right now']] as const
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const thinkingLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const shortcutText = (value: StoredShortcut | null) => value ? formatShortcut(value.keyCode, fromCocoa(value.modifiers), value.label) : ''
const providerName = (provider: string) => provider === 'openai-codex' ? 'Codex' : provider === 'openrouter' ? 'OpenRouter' : provider === 'zai' ? 'Z.AI' : provider

export async function captureScreen(interactive: boolean): Promise<Image | null> {
  const path = join(tmpdir(), `buddymac-liny-${crypto.randomUUID()}.png`)
  const child = Bun.spawn(['/usr/sbin/screencapture', '-x', '-t', 'png', ...interactive ? ['-i'] : ['-C'], path], { stdout: 'ignore', stderr: 'pipe' })
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
  const file = Bun.file(path)
  if (!await file.exists()) { if (code !== 0 || error.trim()) throw new Error('macOS blocked the screenshot. Allow Screen Recording for BuddyMac in System Settings.'); return null }
  try { return { name: interactive ? 'Screen region' : 'Screen', mimeType: 'image/png', data: Buffer.from(await file.arrayBuffer()).toString('base64') } }
  finally { await rm(path, { force: true }) }
}

interface LinyUi { state: LinyState | null; snapshot: LinySnapshot | null; sessions: LinySessions | null; error: string; notice: string; busy: boolean; stream: string }
let ui: LinyUi = { state: null, snapshot: null, sessions: null, error: '', notice: '', busy: false, stream: '' }
const uiListeners = new Set<() => void>()
const setUi = (next: Partial<LinyUi> | ((current: LinyUi) => Partial<LinyUi>)) => { ui = { ...ui, ...(typeof next === 'function' ? next(ui) : next) }; for (const listener of uiListeners) listener() }
let listening = false
async function runLiny(work: () => Promise<unknown>) { setUi({ error: '' }); try { await work() } catch (cause) { setUi({ error: message(cause) }) } }
async function refreshLiny() { const [state, snapshot, sessions] = await Promise.all([liny.state(), liny.snapshot(), liny.sessions()]); setUi({ state, snapshot, sessions }) }
/** Liny's chat state lives outside React so a stream keeps its text while you look at another section. */
function listen() {
  if (listening) return
  listening = true
  void runLiny(refreshLiny)
  liny.onEvent(event => {
    switch (event.event) {
      case 'turn.started': setUi({ busy: true, stream: '' }); break
      case 'delta': setUi(current => ({ stream: current.stream + event.text })); break
      case 'turn.done': setUi({ busy: false, stream: '', notice: '' }); void runLiny(refreshLiny); break
      case 'turn.error': setUi({ busy: false, error: event.message }); void refreshLiny().catch(() => {}); break
      case 'session.reset': setUi({ snapshot: event.snapshot, stream: '' }); break
      case 'notice': case 'auth.progress': setUi({ notice: event.message }); break
      case 'tool.activity': setUi({ notice: `${event.label} · ${event.phase}` }); break
      case 'auth.url': void Bun.spawn(['open', event.url]).exited; break
      case 'auth.device_code': setUi({ notice: `Sign in at ${event.verificationUri} with code ${event.userCode}` }); break
      case 'auth.ok': case 'auth.state': void runLiny(refreshLiny); break
      case 'auth.failed': setUi({ error: event.message }); break
      case 'compacted': break
    }
  })
}
function useLinyChat() {
  useEffect(() => { listen() }, [])
  const current = useSyncExternalStore(listener => { uiListeners.add(listener); return () => { uiListeners.delete(listener) } }, () => ui)
  return {
    ...current,
    setState: (state: LinyState) => setUi({ state }),
    setSnapshot: (update: LinySnapshot | null | ((previous: LinySnapshot | null) => LinySnapshot | null)) => setUi(value => ({ snapshot: typeof update === 'function' ? update(value.snapshot) : update })),
    setSessions: (sessions: LinySessions) => setUi({ sessions }),
    setBusy: (busy: boolean) => setUi({ busy }),
    run: runLiny,
    refresh: refreshLiny,
  }
}

export function LinySidebar({ onExpand, pending, onPendingUsed }: { onExpand: () => void; pending: Image | null; onPendingUsed: () => void }) {
  const chat = useLinyChat()
  return <Page compact>
    <Header compact title="Liny" actions={<Row><Button id="liny-sidebar-new" disabled={chat.busy} onClick={() => void chat.run(async () => { chat.setSnapshot(await liny.reset()); chat.setSessions(await liny.sessions()) })}>New chat</Button><Button id="liny-sidebar-expand" onClick={onExpand}>Expand</Button></Row>} />
    <ErrorText message={chat.error} />
    <Chat {...chat} pending={pending} onPendingUsed={onPendingUsed} autoFocus />
  </Page>
}

export function LinyView({ pending, onPendingUsed }: { pending: Image | null; onPendingUsed: () => void }) {
  const [tab, setTab] = useTab('Liny')
  const { state, setState, snapshot, setSnapshot, sessions, setSessions, error, notice, busy, setBusy, stream, run, refresh } = useLinyChat()
  const actions = <Row><Button id="liny-new-chat" disabled={busy} onClick={() => void run(async () => { setSnapshot(await liny.reset()); setSessions(await liny.sessions()); setTab('Chat') })}>New chat</Button></Row>
  return <TabbedPage id="liny" title="Liny" items={tabs.Liny} tab={tab} onTab={setTab} actions={actions} scroll={tab !== 'Chat'}>
    <ErrorText message={error} />
    {tab === 'Chat' ? <Chat state={state} snapshot={snapshot} setSnapshot={setSnapshot} setSessions={setSessions} busy={busy} setBusy={setBusy} stream={stream} notice={notice} run={run} pending={pending} onPendingUsed={onPendingUsed} /> : null}
    {tab === 'History' ? <Column style={{ gap: 0 }}>
      {sessions?.sessions.map(session => <div key={session.id} role="button" aria-label={session.title || 'Untitled chat'} tabIndex={0} onClick={() => { if (!busy) void run(async () => { setSnapshot(await liny.resume(session.id)); setTab('Chat') }) }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 12, minHeight: space.control + 16, paddingLeft: space.inset, paddingRight: space.inset, borderBottomWidth: 1, borderColor: C.line, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
        <Text style={{ color: session.id === sessions.currentId ? C.accent : C.text }}>{session.title || 'Untitled chat'}</Text>
        <Text muted size={11}>{new Date(session.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
      </div>)}
      {!sessions?.sessions.length ? <Empty>No saved chats yet.</Empty> : null}
    </Column> : null}
    {tab === 'Memory' ? <Memory /> : null}
    {tab === 'Settings' ? <Settings state={state} setState={setState} setSnapshot={setSnapshot} busy={busy} refresh={refresh} run={run} /> : null}
  </TabbedPage>
}

function Chat({ state, snapshot, setSnapshot, setSessions, busy, setBusy, stream, notice, run, pending, onPendingUsed, autoFocus = false }: { state: LinyState | null; snapshot: LinySnapshot | null; setSnapshot: (update: (previous: LinySnapshot | null) => LinySnapshot | null) => void; setSessions: (sessions: LinySessions) => void; busy: boolean; setBusy: (busy: boolean) => void; stream: string; notice: string; run: (work: () => Promise<unknown>) => Promise<void>; pending: Image | null; onPendingUsed: () => void; autoFocus?: boolean }) {
  const { renderer } = useGpuix()
  const [input, setInput] = useSticky('liny-input', ''), [attachments, setAttachments] = useSticky<Image[]>('liny-attachments', []), [screen, setScreen] = useState(false), [capturing, setCapturing] = useState(false)
  useEffect(() => { void Bun.file(screenPreference()).json().then((value: unknown) => setScreen(value === true)).catch(() => {}) }, [])
  useEffect(() => { if (pending) { setAttachments(previous => [...previous, pending].slice(0, 10)); onPendingUsed() } }, [pending])
  async function send() {
    if ((!input.trim() && !attachments.length) || busy) return
    const text = input
    let images = attachments
    if (screen && !images.length && !text.trim().startsWith('/')) { const shot = await captureScreen(false); if (shot) images = [shot] }
    setInput(''); setAttachments([]); setBusy(true)
    setSnapshot(previous => previous ? { ...previous, messages: [...previous.messages, { role: 'user', text, hasImages: images.length > 0 }] } : previous)
    await run(async () => { try { const next = await submitLinyMessage(liny, text, images, setBusy); setSnapshot(() => next); setSessions(await liny.sessions()) } catch (cause) { setInput(text); setAttachments(attachments); throw cause } })
  }
  async function attach() {
    const paths = await renderer?.promptForPaths?.({ files: true, directories: false, multiple: true })
    if (!paths) return
    const images: Image[] = []
    for (const path of paths) {
      const file = Bun.file(path)
      if (!file.type.startsWith('image/')) throw new Error('Choose image attachments.')
      if (file.size > 20_000_000) throw new Error('Each image must be smaller than 20 MB.')
      images.push({ name: path.split('/').at(-1) ?? 'Image', mimeType: file.type, data: Buffer.from(await file.arrayBuffer()).toString('base64') })
    }
    setAttachments(previous => [...previous, ...images].slice(0, 10))
  }
  const hints = input.startsWith('/') && !input.includes(' ') ? commands.filter(([command]) => command.trim().startsWith(input.trim())) : []
  return <>
    <div testId="liny-messages" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflowY: 'scroll', minHeight: 100, gap: 8 }}>
      {!snapshot?.messages.length && !stream ? <Empty>Ask Liny anything. Type / for commands.</Empty> : null}
      {snapshot?.messages.map((entry, index) => <div key={`${snapshot.id}-${index}`} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, paddingTop: 10, paddingBottom: 10, paddingLeft: entry.role === 'user' ? space.inset - 2 : space.inset, paddingRight: space.inset, borderLeftWidth: entry.role === 'user' ? 2 : 0, borderColor: C.accent, gap: 8 }}>{entry.role === 'assistant' ? <markdown source={entry.text} theme={markdownTheme} style={{ color: C.text, fontFamily: font, fontSize: 13 }} /> : <Text>{entry.text}</Text>}{entry.hasImages ? <Text muted size={11}>Image attached</Text> : null}</div>)}
      {stream ? <div style={{ flexShrink: 0, paddingTop: 10, paddingBottom: 10, paddingLeft: space.inset, paddingRight: space.inset }}><markdown source={stream} theme={markdownTheme} style={{ color: C.text, fontFamily: font, fontSize: 13 }} /></div> : null}
    </div>
    {notice ? <Text muted size={11}>{notice}</Text> : null}
    {hints.length ? <Column style={{ gap: 0, flexShrink: 0, borderWidth: 1, borderColor: C.line }}>{hints.map(([command, detail]) => <div key={command} role="button" aria-label={command} tabIndex={0} onClick={() => setInput(command)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, height: 32, paddingLeft: space.inset - 1, paddingRight: space.inset - 1, cursor: 'pointer', hover: { backgroundColor: C.hover } }}><Text style={{ color: C.accent }}>{command.trim()}</Text><Text muted size={11}>{detail}</Text></div>)}</Column> : null}
    {attachments.length ? <Row style={{ flexShrink: 0, flexWrap: 'wrap' }}>{attachments.map((image, index) => <Button key={index} quiet onClick={() => setAttachments(previous => previous.filter((_, position) => position !== index))}>{`Remove ${image.name}`}</Button>)}</Row> : null}
    <Field id="liny-input" value={input} onChange={setInput} onSubmit={() => void send()} placeholder="Message Liny. Return sends, Shift Return adds a line." multiline height={82} autoFocus={autoFocus} />
    <Row style={{ flexShrink: 0 }}>
      <Button id="liny-attach" onClick={() => void run(attach)}>Attach images</Button>
      <Button id="liny-capture" disabled={capturing} onClick={() => { setCapturing(true); void run(async () => { try { const shot = await captureScreen(true); if (shot) setAttachments(previous => [...previous, shot].slice(0, 10)) } finally { setCapturing(false) } }) }}>Capture region</Button>
      <Check id="liny-screen-context" label="Include screen" checked={screen} onChange={next => { setScreen(next); void Bun.write(screenPreference(), JSON.stringify(next)) }} />
      <div style={{ flexGrow: 1 }} />
      <Text muted size={11}>{state ? `${providerName(state.provider)} · ${state.model}` : ''}</Text>
      {busy ? <Button id="liny-stop" onClick={() => void run(() => liny.abort())}>Stop</Button> : <Button id="liny-send" primary disabled={!input.trim() && !attachments.length} onClick={() => void send()}>Send</Button>}
    </Row>
  </>
}
const screenPreference = () => join(profilePaths().root, 'buddymac-screen-context.json')

function Memory() {
  const [paths] = useState(() => profilePaths().memory)
  const [text, setText] = useState(''), [saved, setSaved] = useState(''), [notes, setNotes] = useState<{ name: string; text: string }[]>([]), [error, setError] = useState(''), [open, setOpen] = useState<string | null>(null)
  async function load() {
    const file = Bun.file(paths.memoryFile)
    const value = await file.exists() ? await file.text() : ''
    setText(value); setSaved(value)
    const names = (await readdir(paths.dailyDirectory).catch(() => [])).filter(name => name.endsWith('.md')).sort().reverse()
    setNotes(await Promise.all(names.map(async name => ({ name, text: await Bun.file(join(paths.dailyDirectory, name)).text() }))))
  }
  useEffect(() => { void load().catch(cause => setError(message(cause))) }, [])
  async function save() {
    try {
      await mkdir(join(paths.memoryFile, '..'), { recursive: true, mode: 0o700 })
      const temporary = `${paths.memoryFile}.${crypto.randomUUID()}.tmp`
      await Bun.write(temporary, text.endsWith('\n') || !text ? text : `${text}\n`); await chmod(temporary, 0o600); await rename(temporary, paths.memoryFile)
      setSaved(text); setError('')
    } catch (cause) { setError(message(cause)) }
  }
  return <>
    <ErrorText message={error} />
    <Intro text="Long-term facts Liny reads before every reply. It folds daily notes into this after 3:00 AM.">{text !== saved ? <><Button onClick={() => setText(saved)}>Discard</Button><Button id="liny-memory-save" primary onClick={() => void save()}>Save memory</Button></> : null}</Intro>
    <Field id="liny-memory" value={text} onChange={setText} multiline height={240} placeholder="Nothing remembered yet. Use /remember in a chat, or write here." />
    <Group title="Daily notes">
      {notes.map(note => <div key={note.name} role="button" aria-label={note.name} tabIndex={0} onClick={() => setOpen(open === note.name ? null : note.name)} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8, paddingTop: 12, paddingBottom: 12, paddingLeft: space.inset, paddingRight: space.inset, borderBottomWidth: 1, borderColor: C.line, cursor: 'pointer' }}><Text>{note.name.replace(/\.md$/, '')}</Text>{open === note.name ? <Text muted>{note.text.trim()}</Text> : null}</div>)}
      {notes.length === 0 ? <Empty>No daily notes.</Empty> : null}
    </Group>
  </>
}

function Settings({ state, setState, setSnapshot, busy, refresh, run }: { state: LinyState | null; setState: (state: LinyState) => void; setSnapshot: (update: (previous: LinySnapshot | null) => LinySnapshot | null) => void; busy: boolean; refresh: () => Promise<void>; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [provider, setProvider] = useState<LinyProvider>('openai-codex'), [model, setModel] = useState(''), [thinking, setThinking] = useState<LinyThinking>('medium'), [sources, setSources] = useState<LinySources | null>(null)
  useEffect(() => { if (state) { setModel(state.model); setThinking(state.thinking); if (state.provider !== 'liny') setProvider(state.provider) } }, [state?.model, state?.thinking, state?.provider])
  useEffect(() => { void run(async () => setSources(await liny.importSources())) }, [])
  const layout = useSurfaces()
  const [shortcutError, setShortcutError] = useState('')
  function recordLiny(key: 'open' | 'capture', value: RecordedShortcut) {
    if (!hasModifier(value.modifiers)) { setShortcutError('Use Command, Option or Control in the shortcut.'); return }
    setShortcutError('')
    void surfaces.update(current => ({ ...current, linyShortcuts: { ...current.linyShortcuts, [key]: { keyCode: value.keyCode, modifiers: toCocoa(value.modifiers), label: value.key } } }))
  }
  const loggedIn = state?.providers.find(item => item.id === provider)?.loggedIn
  const models = state?.models.filter(item => item.provider === provider) ?? []
  let account = 0
  return <>
    <Group title="Model">
      <Setting label="Provider" detail={loggedIn ? 'Connected' : 'Not connected'}>
        {(['openai-codex', 'openrouter', 'zai'] as const).map(item => <Button key={item} id={`liny-provider-${item}`} primary={provider === item} onClick={() => { setProvider(item); setModel(state?.models.find(entry => entry.provider === item)?.id ?? '') }}>{providerName(item)}</Button>)}
      </Setting>
      <Setting label="Account" detail={provider === 'openai-codex' ? 'Signs in with your ChatGPT account in the browser.' : 'Uses your own API key.'}>
        <Button id="liny-connect" disabled={busy} onClick={() => void run(async () => { if (provider === 'openai-codex') setState(await liny.login(provider, { method: 'oauth', mode: 'browser' })); else { const key = promptSecret(); if (key) setState(await liny.login(provider, { method: 'api_key', key })) } })}>{loggedIn ? 'Reconnect' : 'Connect'}</Button>
        {loggedIn ? <Button id="liny-disconnect" disabled={busy} onClick={() => void run(async () => setState(await liny.logout(provider)))}>Disconnect</Button> : null}
      </Setting>
      <Setting label="Model" detail={models.length ? `${models.length} available for ${providerName(provider)}` : 'Enter a model ID'}><div style={{ width: 260 }}><Field id="liny-model" value={model} onChange={setModel} placeholder="Model ID" /></div></Setting>
      <Setting label="Reasoning">{thinkingLevels.map(level => <Button id={`liny-thinking-${level}`} key={level} primary={thinking === level} onClick={() => setThinking(level)}>{level === 'xhigh' ? 'X-high' : level.charAt(0).toUpperCase() + level.slice(1)}</Button>)}</Setting>
      <Row style={{ paddingTop: 12, flexShrink: 0 }}><Button id="liny-configure" primary disabled={busy || !model.trim()} onClick={() => void run(async () => setState(await liny.configure({ provider, model: model.trim() }, thinking)))}>Use this model</Button></Row>
    </Group>
    <Group title="Sidebar">
      <Setting label="Open Liny from the screen edge" detail="Hover the edge while the BuddyMac window is closed. Move away to hide it."><Check id="liny-sidebar-enabled" label={layout.linySidebar.enabled ? 'On' : 'Off'} checked={layout.linySidebar.enabled} onChange={enabled => void surfaces.update(current => ({ ...current, linySidebar: { ...current.linySidebar, enabled } }))} /></Setting>
      <Setting label="Screen edge"><Choice id="liny-sidebar-edge" width={200} value={layout.linySidebar.edge} items={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={edge => void surfaces.update(current => ({ ...current, linySidebar: { ...current.linySidebar, edge: edge === 'left' ? 'left' : 'right' } }))} /></Setting>
      <Setting label="Activation area"><Choice id="liny-sidebar-zone" width={200} value={layout.linySidebar.zone} items={[{ value: 'top', label: 'Top third' }, { value: 'middle', label: 'Middle third' }, { value: 'bottom', label: 'Bottom third' }, { value: 'entireEdge', label: 'Entire edge' }]} onChange={zone => void surfaces.update(current => ({ ...current, linySidebar: { ...current.linySidebar, zone: zone === 'top' || zone === 'bottom' || zone === 'entireEdge' ? zone : 'middle' } }))} /></Setting>
    </Group>
    <Group title="Shortcuts">
      <Setting label="Open Liny" detail="Works in every app."><ShortcutField id="liny-shortcut-open" value={shortcutText(layout.linyShortcuts.open)} onRecord={value => recordLiny('open', value)} onClear={() => void surfaces.update(current => ({ ...current, linyShortcuts: { ...current.linyShortcuts, open: null } }))} /></Setting>
      <Setting label="Capture a screen region" detail="Opens Liny with the region attached."><ShortcutField id="liny-shortcut-capture" value={shortcutText(layout.linyShortcuts.capture)} onRecord={value => recordLiny('capture', value)} onClear={() => void surfaces.update(current => ({ ...current, linyShortcuts: { ...current.linyShortcuts, capture: null } }))} /></Setting>
      <ErrorText message={shortcutError} />
    </Group>
    <Group title="Permissions">
      <Setting label="Screen Recording" detail="Needed for Include screen and Capture region."><Button onClick={() => openSettingsPane('screen')}>Open settings</Button></Setting>
    </Group>
    <Group title="Original Liny">
      {sources?.sources.map(source => { const name = source.id === 'legacy' ? source.label : `Liny account ${++account}`; return <Setting key={source.id} label={name} detail={`${source.sessionFiles} ${source.sessionFiles === 1 ? 'conversation' : 'conversations'}${source.hasMemory ? ' · memory' : ''}${sources.activeProfile === source.id ? ' · in use' : ''}`}>
        <Button disabled={busy} onClick={() => void run(async () => { const next = await liny.importSource(source.id); setSnapshot(() => next); await refresh() })}>Import</Button>
        <Button disabled={busy} onClick={() => void run(async () => { const next = await liny.importSource(source.id, true); setSnapshot(() => next); await refresh() })}>Import with sign-in</Button>
      </Setting> })}
      {!sources?.sources.length ? <Empty>No original Liny profiles found.</Empty> : null}
    </Group>
  </>
}
