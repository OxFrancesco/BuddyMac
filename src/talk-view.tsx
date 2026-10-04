import { useEffect, useState } from 'react'
import { useGpuix } from '@gpuix/react'
import { requestCompact } from './panel'
import { setSpeechShortcuts } from './speech-shortcuts'
import { speechHistoryDate, type DictationStyle, type SpeechHistoryEntry, type SpeechNeed, type SpeechPreferences, type SpeechShortcut, type VocabularyEntry } from './speech'
import { speech, useSpeech } from './speech-state'
import { talkPrefs, useTalkPrefs } from './talk-prefs'
import { useSticky } from './sticky'
import { appBundleInfo, chooseSaveLocation, copyText, openSettingsPane, promptSecret } from './platform'
import { tabs, useTab } from './nav'
import { surfaces, useSurfaces } from './surfaces'
import { formatShortcut, fromCarbon, toCarbon, type RecordedShortcut } from './shortcuts'
import { Button, C, Check, Choice, Column, Empty, ErrorText, Field, Group, Intro, Labeled, Row, Setting, ShortcutField, Stacked, TabbedPage, Text, space } from './ui'

const styles: { value: DictationStyle; label: string; detail: string }[] = [
  { value: 'natural', label: 'Natural', detail: 'Removes fillers and fixes punctuation. Keeps your voice.' },
  { value: 'casual', label: 'Casual', detail: 'Relaxed, like a message to a friend.' },
  { value: 'professional', label: 'Professional', detail: 'Clear and polished, for work email and documents.' },
  { value: 'verbatim', label: 'Verbatim', detail: 'Exactly what you said. Skips the cleanup model.' },
]
const languages = [['auto', 'Detect automatically'], ['en', 'English'], ['it', 'Italian'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['ru', 'Russian']].map(([value, label]) => ({ value: value!, label: label! }))
const shortcutActions = [
  ['hold', 'Hold to dictate', 'Hold the keys while you speak. Release to insert.'],
  ['toggle', 'Hands-free dictation', 'Press once to start and again to finish.'],
  ['edit', 'Edit selected text by voice', 'Select text in any app, press, and say how to change it.'],
  ['cancel', 'Cancel', 'Stops dictation before anything is inserted.'],
] as const
const defaultShortcuts: SpeechPreferences['shortcuts'] = {
  hold: { keyCode: 49, modifiers: 6144, keyLabel: 'Space' },
  toggle: { keyCode: 36, modifiers: 6144, keyLabel: 'Return' },
  edit: { keyCode: 14, modifiers: 6144, keyLabel: 'E' },
  cancel: { keyCode: 53, modifiers: 0, keyLabel: 'Escape' },
}
const label = (shortcut: SpeechShortcut) => formatShortcut(shortcut.keyCode, fromCarbon(shortcut.modifiers), shortcut.keyLabel)
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const needLabels: Record<SpeechNeed, string> = { screenRecording: 'Allow Screen Recording', accessibility: 'Allow Accessibility', microphone: 'Allow microphone' }
async function allow(need: SpeechNeed) {
  if (need === 'microphone') openSettingsPane('microphone')
  else if (need === 'accessibility') await speech().requestAccessibility()
  else await speech().requestScreenCapture()
}

/** The permission the last dictation was missing, offered right under its warning. */
export function PermissionButtons({ needs, onError }: { needs: SpeechNeed[]; onError: (message: string) => void }) {
  if (!needs.length) return null
  return <Row style={{ flexShrink: 0 }}>{needs.map(need => <Button key={need} id={`talk-allow-${need}`} onClick={() => void allow(need).catch(cause => onError(message(cause)))}>{needLabels[need]}</Button>)}</Row>
}

export function TalkView() {
  const s = useSpeech()
  const prefs = useTalkPrefs()
  const [tab, setTab] = useTab('Talk')
  const { renderer } = useGpuix()
  const [history, setHistory] = useState<SpeechHistoryEntry[]>([])
  const [error, setError] = useState('')
  const recording = s.phase === 'recording', busy = !['idle', 'recording', 'success', 'failed'].includes(s.phase)
  async function act(work: () => Promise<unknown>) { setError(''); try { await work() } catch (cause) { setError(message(cause)) } }
  async function refreshHistory() { try { setHistory(await speech().history()) } catch (cause) { setError(message(cause)) } }
  useEffect(() => { void refreshHistory() }, [s.resultVersion, s.status?.historyCount])
  const edit = (update: (draft: SpeechPreferences) => SpeechPreferences) => talkPrefs.edit(update)
  const draft = prefs.draft
  const actions = <Row>
    {prefs.dirty ? <><Button id="talk-discard" onClick={() => talkPrefs.discard()}>Discard</Button><Button id="talk-save-preferences" primary disabled={prefs.saving} onClick={() => void talkPrefs.save()}>{prefs.saving ? 'Saving' : 'Save changes'}</Button></> : null}
    <Button id="talk-compact" onClick={() => requestCompact('talk')}>Compact recorder</Button>
  </Row>
  const errors = <><ErrorText message={error || s.error} />{error ? null : <PermissionButtons needs={s.needs} onError={setError} />}<ErrorText message={prefs.error} /></>
  return <TabbedPage id="talk" title="Talk" items={tabs.Talk} tab={tab} onTab={setTab} actions={actions}>
    {errors}
    {tab === 'Record' ? <RecordTab s={s} recording={recording} busy={busy} history={history} importAudio={() => void s.run(async () => { const paths = await renderer?.promptForPaths?.({ files: true, directories: false, multiple: false }); if (paths?.[0]) await speech().importAudio(paths[0]) })} /> : null}
    {tab === 'History' ? <HistoryTab history={history} saveHistory={draft?.saveHistory ?? true} onChange={() => void refreshHistory()} act={act} /> : null}
    {draft && tab === 'Dictionary' ? <DictionaryTab draft={draft} edit={edit} act={act} renderer={renderer} /> : null}
    {draft && tab === 'Snippets' ? <SnippetsTab draft={draft} edit={edit} /> : null}
    {draft && tab === 'Style' ? <StyleTab draft={draft} edit={edit} act={act} renderer={renderer} /> : null}
    {draft && tab === 'Shortcuts' ? <ShortcutsTab draft={draft} edit={edit} enabled={!!s.status?.shortcutsEnabled} accessibility={!!s.status?.accessibilityGranted} act={act} refresh={s.refresh} /> : null}
    {draft && tab === 'Settings' ? <SettingsTab draft={draft} edit={edit} memory={prefs.memory} keyConfigured={!!s.status?.keyConfigured} localModel={s.status?.localModelPresent ? s.status.localModelPath : ''} screenAllowed={!!s.status?.screenCaptureGranted} act={act} refresh={s.refresh} /> : null}
  </TabbedPage>
}

function RecordTab({ s, recording, busy, history, importAudio }: { s: ReturnType<typeof useSpeech>; recording: boolean; busy: boolean; history: SpeechHistoryEntry[]; importAudio: () => void }) {
  const [scratch, setScratch] = useSticky('talk-scratch', '')
  const status = recording ? 'Listening' : busy ? s.phase === 'transcribing' ? 'Transcribing audio' : s.phase === 'formatting' ? 'Cleaning up text' : s.phase === 'inserting' ? 'Inserting text' : 'Working' : s.status?.keyConfigured ? 'Ready to dictate' : 'Add your OpenRouter key to start'
  const hold = useTalkPrefs().saved?.shortcuts.hold
  const last = s.text || history[0]?.text || ''
  return <>
    <Row style={{ paddingBottom: space.gap, borderBottomWidth: 1, borderColor: C.line, justifyContent: 'space-between', flexShrink: 0 }}>
      <Column style={{ flexGrow: 1, gap: 8 }}>
        <Text size={16}>{status}</Text>
        {recording ? <div style={{ width: 200, height: 4, backgroundColor: C.line }}><div style={{ height: 4, width: Math.max(4, Math.min(200, s.level * 200)), backgroundColor: C.accent }} /></div>
          : <Text muted size={11}>{s.status?.shortcutsEnabled && hold ? `Hold ${label(hold)} in any app to dictate.` : 'Turn on shortcuts in the Shortcuts tab to dictate from any app.'}</Text>}
      </Column>
      <Row>
        {s.status?.keyConfigured ? null : <Button id="talk-set-key" onClick={() => { const value = promptSecret(); if (value) void s.run(() => speech().setKey({ provider: 'openRouter', value })) }}>Set API key</Button>}
        <Button id="talk-import-audio" disabled={busy || recording || !s.status?.keyConfigured} onClick={importAudio}>Import audio</Button>
        {recording || busy ? <Button onClick={() => void s.run(() => speech().cancel())}>Cancel</Button> : null}
        {s.status?.canRetry ? <Button onClick={() => void s.run(() => speech().retry())}>Retry</Button> : null}
        <Button id="talk-record" primary disabled={busy || (!recording && !s.status?.keyConfigured)} onClick={() => void s.run(() => recording ? speech().stop() : speech().start())}>{recording ? 'Stop and transcribe' : 'Record'}</Button>
      </Row>
    </Row>
    {s.text ? <Column style={{ flexShrink: 0 }}>
      <Stacked label="Latest transcript"><Field id="talk-result" value={s.text} onChange={s.setText} multiline height={110} /></Stacked>
      {s.raw && s.raw !== s.text ? <Text muted size={11}>{`Original: ${s.raw}`}</Text> : null}
      <Row><Button onClick={() => copyText(s.text)}>Copy text</Button>{s.raw && s.raw !== s.text ? <Button onClick={() => copyText(s.raw)}>Copy original</Button> : null}</Row>
    </Column> : null}
    <Column style={{ flexShrink: 0 }}>
      <Stacked label="Scratchpad"><Field id="talk-scratchpad" value={scratch} onChange={setScratch} multiline height={160} placeholder="Try dictation here, or edit your last transcript. Nothing here is saved." /></Stacked>
      <Row><Button id="talk-scratch-last" disabled={!last} onClick={() => setScratch(last)}>Use last transcript</Button><Button disabled={!scratch} onClick={() => copyText(scratch)}>Copy</Button><Button disabled={!scratch} onClick={() => setScratch('')}>Clear</Button></Row>
    </Column>
  </>
}

function HistoryTab({ history, saveHistory, onChange, act }: { history: SpeechHistoryEntry[]; saveHistory: boolean; onChange: () => void; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null), [confirm, setConfirm] = useState(false)
  const shown = history.filter(item => `${item.text} ${item.rawText} ${item.appName}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    {saveHistory ? null : <Setting label="History is off" detail="New transcripts aren't saved."><Button onClick={() => { talkPrefs.edit(draft => ({ ...draft, saveHistory: true })); void talkPrefs.save() }}>Turn on</Button></Setting>}
    <Row style={{ flexShrink: 0 }}>
      <Field id="talk-search" value={query} onChange={setQuery} placeholder="Search transcripts" />
      {confirm ? <><Button id="talk-clear-history-confirm" onClick={() => void act(async () => { await speech().clearHistory(); setConfirm(false); onChange() })}>Delete all</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></>
        : <Button id="talk-clear-history" disabled={!history.length} onClick={() => setConfirm(true)}>Clear history</Button>}
    </Row>
    <Column style={{ gap: 0 }}>
      {shown.map(item => { const open = selected === item.id; return <div key={item.id} onClick={() => setSelected(open ? null : item.id)} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8, paddingTop: 16, paddingBottom: 16, paddingLeft: space.inset, paddingRight: space.inset, borderBottomWidth: 1, borderColor: C.line, cursor: 'pointer' }}>
        <Text muted size={11}>{[speechHistoryDate(item).toLocaleString(), item.appName, item.duration ? `${Math.round(item.duration)} s` : ''].filter(Boolean).join(' · ')}</Text>
        <Text>{open ? item.text : item.text.slice(0, 180)}</Text>
        {open && item.rawText && item.rawText !== item.text ? <Column style={{ gap: 4 }}><Text muted size={11}>Original transcription</Text><Text muted>{item.rawText}</Text></Column> : null}
        {open ? <Row><Button onClick={() => copyText(item.text)}>Copy text</Button>{item.rawText && item.rawText !== item.text ? <Button onClick={() => copyText(item.rawText)}>Copy original</Button> : null}<Button onClick={() => void act(async () => { await speech().deleteHistory(item.id); setSelected(null); onChange() })}>Delete</Button></Row> : null}
      </div> })}
      {shown.length === 0 ? <Empty>{query ? 'No matching transcripts.' : 'Your transcripts will appear here.'}</Empty> : null}
    </Column>
  </>
}

type Renderer = ReturnType<typeof useGpuix>['renderer']
function DictionaryTab({ draft, edit, act, renderer }: { draft: SpeechPreferences; edit: (update: (draft: SpeechPreferences) => SpeechPreferences) => void; act: (work: () => Promise<unknown>) => Promise<void>; renderer: Renderer }) {
  const update = (entry: VocabularyEntry, next: Partial<VocabularyEntry>) => edit(value => ({ ...value, vocabulary: value.vocabulary.map(item => item.id === entry.id ? { ...entry, ...next } : item) }))
  return <>
    <Intro text="Map a spoken or misheard phrase to its exact spelling. Leave the second field empty to keep a word's spelling as a hint.">
        <Button id="talk-dictionary-import" onClick={() => void act(async () => {
          const paths = await renderer?.promptForPaths?.({ files: true, directories: false, multiple: false })
          if (!paths?.[0]) return
          const imported: unknown = await Bun.file(paths[0]).json()
          if (!Array.isArray(imported)) throw new Error('Choose a BuddyTalk dictionary export.')
          edit(value => {
            const known = new Set(value.vocabulary.map(item => item.spoken.toLowerCase()))
            const added = imported.flatMap((entry: unknown) => {
              if (typeof entry !== 'object' || entry === null || !('spoken' in entry) || typeof entry.spoken !== 'string' || !entry.spoken.trim()) return []
              const replacement = 'replacement' in entry && typeof entry.replacement === 'string' ? entry.replacement : ''
              if (known.has(entry.spoken.toLowerCase())) return []
              known.add(entry.spoken.toLowerCase())
              return [{ id: crypto.randomUUID(), spoken: entry.spoken, replacement }]
            })
            return { ...value, vocabulary: [...value.vocabulary, ...added] }
          })
        })}>Import</Button>
        <Button id="talk-dictionary-export" disabled={!draft.vocabulary.length} onClick={() => void act(async () => {
          const path = await chooseSaveLocation('BuddyTalk-dictionary.json', 'Export your dictionary')
          if (path) await Bun.write(path, JSON.stringify(draft.vocabulary.map(({ id, spoken, replacement }) => ({ id: id.toUpperCase(), replacement, spoken })), null, 2))
        })}>Export</Button>
    </Intro>
    <Column style={{ gap: 8 }}>
      {draft.vocabulary.map((entry, index) => <Row key={entry.id}>
        <Field id={`vocab-spoken-${index}`} value={entry.spoken} onChange={spoken => update(entry, { spoken })} placeholder="Spoken or misheard" />
        <Field id={`vocab-replacement-${index}`} value={entry.replacement} onChange={replacement => update(entry, { replacement })} placeholder="Write as" />
        <Button quiet onClick={() => edit(value => ({ ...value, vocabulary: value.vocabulary.filter(item => item.id !== entry.id) }))}>Remove</Button>
      </Row>)}
      {draft.vocabulary.length === 0 ? <Empty>No words yet.</Empty> : null}
    </Column>
    <Row><Button id="talk-add-word" onClick={() => edit(value => ({ ...value, vocabulary: [...value.vocabulary, { id: crypto.randomUUID(), spoken: '', replacement: '' }] }))}>Add word</Button></Row>
  </>
}

function SnippetsTab({ draft, edit }: { draft: SpeechPreferences; edit: (update: (draft: SpeechPreferences) => SpeechPreferences) => void }) {
  return <>
    <Intro text="Say the trigger and Talk types the full text, such as a signature, a link or an address." />
    <Column style={{ gap: 8 }}>
      {draft.snippets.map((entry, index) => <Row key={entry.id} style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 200, flexShrink: 0 }}><Field id={`snippet-trigger-${index}`} value={entry.trigger} onChange={trigger => edit(value => ({ ...value, snippets: value.snippets.map(item => item.id === entry.id ? { ...entry, trigger } : item) }))} placeholder="Spoken trigger" /></div>
        <div style={{ flexGrow: 1, minWidth: 0 }}><Field id={`snippet-expansion-${index}`} value={entry.expansion} multiline height={72} onChange={expansion => edit(value => ({ ...value, snippets: value.snippets.map(item => item.id === entry.id ? { ...entry, expansion } : item) }))} placeholder="Expands to" /></div>
        <Button quiet onClick={() => edit(value => ({ ...value, snippets: value.snippets.filter(item => item.id !== entry.id) }))}>Remove</Button>
      </Row>)}
      {draft.snippets.length === 0 ? <Empty>No snippets yet.</Empty> : null}
    </Column>
    <Row><Button id="talk-add-snippet" onClick={() => edit(value => ({ ...value, snippets: [...value.snippets, { id: crypto.randomUUID(), trigger: '', expansion: '' }] }))}>Add snippet</Button></Row>
  </>
}

function StyleTab({ draft, edit, act, renderer }: { draft: SpeechPreferences; edit: (update: (draft: SpeechPreferences) => SpeechPreferences) => void; act: (work: () => Promise<unknown>) => Promise<void>; renderer: Renderer }) {
  return <>
    <Group title="Default style">
      {styles.map(style => <Setting key={style.value} label={style.label} detail={style.detail}><Check id={`talk-style-${style.value}`} label={draft.style === style.value ? 'In use' : 'Use'} checked={draft.style === style.value} onChange={() => edit(value => ({ ...value, style: style.value }))} /></Setting>)}
    </Group>
    <Group title="By app">
      {draft.appStyles.map(rule => <Setting key={rule.id} label={rule.name} detail={rule.bundleID}>
        <Choice id={`talk-app-style-${rule.bundleID}`} width={170} value={rule.style} items={styles} onChange={next => edit(value => ({ ...value, appStyles: value.appStyles.map(item => item.id === rule.id ? { ...rule, style: next as DictationStyle } : item) }))} />
        <Button quiet onClick={() => edit(value => ({ ...value, appStyles: value.appStyles.filter(item => item.id !== rule.id) }))}>Remove</Button>
      </Setting>)}
      {draft.appStyles.length === 0 ? <Empty>Every app uses the default style.</Empty> : null}
    </Group>
    <Row><Button id="talk-add-app-style" onClick={() => void act(async () => {
      const paths = await renderer?.promptForPaths?.({ files: true, directories: false, multiple: false })
      if (!paths?.[0]) return
      const app = await appBundleInfo(paths[0])
      if (draft.appStyles.some(rule => rule.bundleID === app.bundleID)) throw new Error(`${app.name} already has a style.`)
      edit(value => ({ ...value, appStyles: [...value.appStyles, { id: crypto.randomUUID(), bundleID: app.bundleID, name: app.name, style: value.style }] }))
    })}>Add app</Button></Row>
  </>
}

function ShortcutsTab({ draft, edit, enabled, accessibility, act, refresh }: { draft: SpeechPreferences; edit: (update: (draft: SpeechPreferences) => SpeechPreferences) => void; enabled: boolean; accessibility: boolean; act: (work: () => Promise<unknown>) => Promise<void>; refresh: () => Promise<void> }) {
  const record = (action: keyof SpeechPreferences['shortcuts'], shortcut: RecordedShortcut) => {
    edit(value => ({ ...value, shortcuts: { ...value.shortcuts, [action]: { keyCode: shortcut.keyCode, modifiers: toCarbon(shortcut.modifiers), keyLabel: shortcut.key } } }))
    void talkPrefs.save()
  }
  return <>
    <Setting label="Use these shortcuts in every app" detail="Turn off the same shortcuts in BuddyTalk first so they don't fire twice."><Check id="talk-shortcuts-enabled" label={enabled ? 'On' : 'Off'} checked={enabled} onChange={next => void act(async () => { await setSpeechShortcuts(next); await refresh() })} /></Setting>
    {accessibility ? null : <Setting label="Text insertion needs Accessibility" detail="Without it, transcripts are copied to the clipboard instead of typed into the app you're using."><Button onClick={() => void act(async () => { await speech().requestAccessibility(); openSettingsPane('accessibility'); await refresh() })}>Allow</Button></Setting>}
    {Object.values(draft.shortcuts).some(shortcut => shortcut.keyCode === 63) ? <Setting label="Fn key" detail={'In macOS Keyboard settings, set "Press Globe key to" to "Do Nothing". Fn shortcuts also need Accessibility access.'}><Button id="talk-fn-keyboard-settings" onClick={() => openSettingsPane('keyboard')}>Keyboard settings</Button></Setting> : null}
    <Group title="Shortcuts">
      {shortcutActions.map(([action, name, detail]) => <Setting key={action} label={name} detail={detail}><ShortcutField allowFn id={`talk-shortcut-${action}`} value={label(draft.shortcuts[action])} onRecord={shortcut => record(action, shortcut)} /></Setting>)}
    </Group>
    <Row><Button id="talk-shortcuts-defaults" onClick={() => { edit(value => ({ ...value, shortcuts: defaultShortcuts })); void talkPrefs.save() }}>Restore defaults</Button></Row>
  </>
}

function SettingsTab({ draft, edit, memory, keyConfigured, localModel, screenAllowed, act, refresh }: { draft: SpeechPreferences; edit: (update: (draft: SpeechPreferences) => SpeechPreferences) => void; memory: string; keyConfigured: boolean; localModel: string; screenAllowed: boolean; act: (work: () => Promise<unknown>) => Promise<void>; refresh: () => Promise<void> }) {
  const [downloading, setDownloading] = useState(false)
  const layout = useSurfaces()
  const flag = (key: 'cleanupEnabled' | 'localCleanupEnabled' | 'autoPaste' | 'restoreClipboard' | 'saveHistory' | 'playSounds' | 'screenContextEnabled' | 'memoryEnabled') => (next: boolean) => edit(value => ({ ...value, [key]: next }))
  const ownModel = localModel.includes('/BuddyMac/')
  return <>
    <Group title="Account">
      <Setting label="OpenRouter key" detail={keyConfigured ? 'Saved in Keychain. Used for audio transcription.' : 'Needed for audio transcription.'}>
        <Button id="talk-key" onClick={() => { const value = promptSecret(); if (value) void act(async () => { await speech().setKey({ provider: 'openRouter', value }); await refresh() }) }}>{keyConfigured ? 'Replace key' : 'Set API key'}</Button>
        {keyConfigured ? <Button onClick={() => void act(async () => { await speech().removeKey(); await refresh() })}>Remove</Button> : null}
      </Setting>
    </Group>
    <Group title="Transcription">
      <Setting label="Spoken language" detail="Local cleanup needs English."><Choice id="talk-language" value={draft.language} items={languages} onChange={language => edit(value => ({ ...value, language }))} /></Setting>
      <Setting label="Clean up my dictation" detail="Removes fillers and fixes punctuation with the cloud model."><Check id="talk-cleanup" label={draft.cleanupEnabled ? 'On' : 'Off'} checked={draft.cleanupEnabled} onChange={flag('cleanupEnabled')} /></Setting>
      <Setting label="Cloud cleanup model" detail="OpenRouter model ID. A connected ChatGPT provider uses the model in AI settings."><div style={{ width: 280 }}><Field id="talk-cleanup-model" value={draft.cleanupModel} onChange={cleanupModel => edit(value => ({ ...value, cleanupModel }))} placeholder="OpenRouter model ID" /></div></Setting>
      <Setting label="Clean up English on this Mac" detail={localModel ? 'S1-mini by Superwhisper is downloaded.' : 'Downloads S1-mini by Superwhisper, 462 MiB. Audio still goes to OpenRouter.'}>
        {localModel ? <Check id="talk-local-cleanup" label={draft.localCleanupEnabled ? 'On' : 'Off'} checked={draft.localCleanupEnabled} onChange={flag('localCleanupEnabled')} />
          : downloading ? <Button onClick={() => void act(() => speech().cancelLocalDownload())}>Cancel download</Button>
          : <Button id="talk-download-model" onClick={() => { setDownloading(true); void act(async () => { try { await speech().downloadLocalCleanup(); await refresh() } finally { setDownloading(false) } }) }}>Download</Button>}
        {localModel && ownModel ? <Button onClick={() => void act(async () => { await speech().removeLocalModel(); edit(value => ({ ...value, localCleanupEnabled: false })); await refresh() })}>Remove download</Button> : null}
      </Setting>
    </Group>
    <Group title="Recorder">
      <Setting label="Show the dictation pill" detail="Appears at the bottom of the screen while you speak and while Talk transcribes."><Check id="talk-pill" label={layout.talkPill ? 'On' : 'Off'} checked={layout.talkPill} onChange={talkPill => void surfaces.update(current => ({ ...current, talkPill }))} /></Setting>
    </Group>
    <Group title="Insertion">
      <Setting label="Paste into the active app" detail="Otherwise the transcript is copied to the clipboard."><Check id="talk-auto-paste" label={draft.autoPaste ? 'On' : 'Off'} checked={draft.autoPaste} onChange={flag('autoPaste')} /></Setting>
      <Setting label="Restore the clipboard afterwards"><Check label={draft.restoreClipboard ? 'On' : 'Off'} checked={draft.restoreClipboard} onChange={flag('restoreClipboard')} /></Setting>
      <Setting label="Start and stop sounds"><Check label={draft.playSounds ? 'On' : 'Off'} checked={draft.playSounds} onChange={flag('playSounds')} /></Setting>
      <Setting label="Save dictation history" detail={draft.saveHistory ? 'Up to 200 transcripts stay on this Mac.' : 'Saving turns this off and deletes the saved history.'}><Check id="talk-save-history" label={draft.saveHistory ? 'On' : 'Off'} checked={draft.saveHistory} onChange={flag('saveHistory')} /></Setting>
    </Group>
    <Group title="Context">
      <Setting label="Use screen context" detail="Sends a screenshot of the active window with cloud cleanup and voice editing.">
        {draft.screenContextEnabled && !screenAllowed ? <Button onClick={() => void act(async () => { await speech().requestScreenCapture(); openSettingsPane('screen'); await refresh() })}>Allow Screen Recording</Button> : null}
        <Check id="talk-screen-context" label={draft.screenContextEnabled ? 'On' : 'Off'} checked={draft.screenContextEnabled} onChange={flag('screenContextEnabled')} />
      </Setting>
      <Setting label="Use memory" detail="Names, project terms and writing preferences sent to the cleanup model."><Check id="talk-memory-enabled" label={draft.memoryEnabled ? 'On' : 'Off'} checked={draft.memoryEnabled} onChange={flag('memoryEnabled')} /></Setting>
      <div style={{ paddingTop: 12, flexShrink: 0 }}><Field id="talk-memory" value={memory} onChange={text => talkPrefs.setMemory(text)} multiline height={160} placeholder="Context and writing preferences" /></div>
    </Group>
  </>
}
