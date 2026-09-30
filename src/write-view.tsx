import { useEffect, useRef, useState } from 'react'
import { speech, useSpeech } from './speech-state'
import { useSticky } from './sticky'
import type { WriteHotkey, WritingNote, WritingProfile, WritingState } from './speech'
import { setSpeechShortcuts } from './speech-shortcuts'
import { copyText, nativeKeyLabel, promptSecret } from './platform'
import { nav, tabs, useTab } from './nav'
import { formatShortcut, fromCocoa, hasModifier, toCocoa, type RecordedShortcut } from './shortcuts'
import { Button, C, Check, Choice, Column, Empty, ErrorText, Field, Group, Intro, Row, Setting, ShortcutField, Stacked, TabbedPage, Text, space } from './ui'

const templates = [
  { name: 'Formal', instruction: 'Rewrite the selected text into a more formal, polished version while preserving its meaning. Return only the final text.' },
  { name: 'Email', instruction: 'Rewrite the selected text into a clear, professional email. Keep it natural. Return only the final text.' },
  { name: 'Twitter Post', instruction: 'Rewrite the selected text into a concise single Twitter/X-style post, under 280 characters when reasonably possible. Return only the final text.' },
  { name: 'New profile', instruction: 'Rewrite the selected text. Return only the final text.' },
]
const hotkeyLabel = (hotkey?: WriteHotkey) => hotkey ? formatShortcut(hotkey.keyCode, fromCocoa(hotkey.modifiersRawValue), nativeKeyLabel(hotkey.keyCode)) : ''
const toHotkey = (shortcut: RecordedShortcut): WriteHotkey => {
  if (!hasModifier(shortcut.modifiers)) throw new Error('Use Command, Option or Control in the shortcut.')
  return { keyCode: shortcut.keyCode, modifiersRawValue: toCocoa(shortcut.modifiers) }
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function WriteView() {
  const s = useSpeech('write')
  const [tab, setTab] = useTab('Write')
  const [data, setData] = useState<WritingState | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setData(await speech().writing()); await s.refresh() }
  async function run(work: () => Promise<unknown>) { setError(''); try { await work(); await refresh() } catch (cause) { setError(message(cause)) } }
  useEffect(() => { void run(async () => {}) }, [])
  return <TabbedPage id="write" title="Write" items={tabs.Write} tab={tab} onTab={setTab}>
    <ErrorText message={error || s.error} />
    {s.status && !s.status.keyConfigured ? <Setting label="OpenRouter key required" detail="Write uses the same key as Talk."><Button id="write-set-key" onClick={() => { const value = promptSecret(); if (value) void run(() => speech().setKey({ provider: 'openRouter', value })) }}>Set API key</Button></Setting> : null}
    {tab === 'Rewrite' ? <RewriteTab s={s} profiles={data?.profiles ?? s.status?.profiles ?? []} /> : null}
    {tab === 'Profiles' && data ? <ProfilesTab data={data} run={run} /> : null}
    {tab === 'Notes' && data ? <NotesTab data={data} run={run} /> : null}
    {tab === 'Settings' && data ? <SettingsTab data={data} shortcutsEnabled={!!s.status?.shortcutsEnabled} run={run} /> : null}
  </TabbedPage>
}

function RewriteTab({ s, profiles }: { s: ReturnType<typeof useSpeech>; profiles: WritingProfile[] }) {
  const [input, setInput] = useSticky('write-input', ''), [output, setOutput] = useSticky('write-output', ''), [profile, setProfile] = useSticky('write-profile', ''), [busy, setBusy] = useState(false)
  const revision = useRef(0)
  const active = profile || profiles[0]?.id || ''
  function editOutput(value: string) { revision.current++; setOutput(value) }
  async function rewrite() {
    setBusy(true)
    const startedAt = revision.current
    await s.run(async () => { const result = await speech().rewrite({ text: input, ...(active ? { profileId: active } : {}) }); if (revision.current === startedAt) setOutput(result.text) })
    setBusy(false)
  }
  return <>
    <Row style={{ flexShrink: 0, justifyContent: 'space-between' }}>
      <Row>
        <Choice id="write-profile" width={220} value={active} items={profiles.map(item => ({ value: item.id, label: item.name }))} onChange={setProfile} />
        <Text muted size={11}>{s.status?.writeProvider === 'openRouter' ? s.status.writeModel : 'Local model unavailable'}</Text>
      </Row>
      <Button id="write-rewrite" primary disabled={!input.trim() || busy} onClick={() => void rewrite()}>{busy ? 'Rewriting' : 'Rewrite'}</Button>
    </Row>
    <Field id="write-input" value={input} onChange={setInput} placeholder="Text to rewrite" multiline height={180} />
    <Field id="write-output" value={output} onChange={editOutput} placeholder="Rewritten text" multiline height={180} />
    <Row style={{ flexShrink: 0 }}><Button disabled={!output} onClick={() => copyText(output)}>Copy result</Button><Button disabled={!output} onClick={() => { setInput(output); editOutput('') }}>Use as input</Button><Button onClick={() => { setInput(''); editOutput('') }}>Clear</Button></Row>
    <Intro text="In any app, select text and press a profile's shortcut to rewrite it in place. Set shortcuts in Profiles." />
  </>
}

function ProfilesTab({ data, run }: { data: WritingState; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<WritingProfile | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const save = (profile: WritingProfile) => run(async () => { const saved = await speech().saveProfile(profile); setEditing(current => current?.id === saved.id ? saved : current) })
  return <>
    <Intro text="Each profile is a rewrite instruction. Give it a shortcut to use it on selected text in any app."><Button id="write-new-profile" onClick={() => setAdding(!adding)}>New profile</Button></Intro>
    {adding ? <Row style={{ flexWrap: 'wrap', flexShrink: 0 }}>{templates.map(template => <Button key={template.name} id={`write-template-${template.name.toLowerCase().replace(/\s+/g, '-')}`} onClick={() => void run(async () => { setAdding(false); setEditing(await speech().createProfile(template)) })}>{template.name === 'New profile' ? 'Blank' : template.name}</Button>)}</Row> : null}
    <ErrorText message={error} />
    <Column style={{ gap: 0 }}>
      {data.profiles.map((profile, index) => <div key={profile.id} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderBottomWidth: 1, borderColor: C.line }}>
        <Row style={{ minHeight: space.control + 16, paddingLeft: space.inset }}>
          <Column style={{ flexGrow: 1, gap: 4 }}><Text>{profile.name}</Text><Text muted size={11}>{profile.hotkey ? hotkeyLabel(profile.hotkey) : 'No shortcut'}{profile.openRouterModelID ? ` · ${profile.openRouterModelID}` : ''}</Text></Column>
          <Check id={`write-profile-enabled-${index}`} label="Shortcut on" checked={profile.isEnabled} disabled={!profile.hotkey} onChange={isEnabled => void save({ ...profile, isEnabled })} />
          <Row style={{ gap: 0 }}>
            {profile.isBuiltIn ? null : <><Button quiet disabled={index <= 1} onClick={() => void run(() => speech().moveProfile(profile.id, 'up'))}>Up</Button><Button quiet disabled={index === data.profiles.length - 1} onClick={() => void run(() => speech().moveProfile(profile.id, 'down'))}>Down</Button></>}
            {editing?.id === profile.id ? <Button id="profile-save" primary onClick={() => void save(editing)}>Save</Button> : null}
            <Button quiet id={`write-profile-edit-${index}`} onClick={() => setEditing(editing?.id === profile.id ? null : profile)}>{editing?.id === profile.id ? 'Close' : 'Edit'}</Button>
          </Row>
        </Row>
        {editing?.id === profile.id ? <Column style={{ paddingLeft: space.inset, paddingRight: space.inset, paddingBottom: 16 }}>
          {profile.isBuiltIn ? <Text muted size={11}>The Standard profile's name and instruction are fixed. You can change its shortcut and model.</Text>
            : <><Stacked label="Name"><Field id="profile-name" value={editing.name} onChange={name => setEditing(current => current && { ...current, name })} placeholder="Profile name" /></Stacked>
              <Stacked label="Instruction"><Field id="profile-instruction" value={editing.instruction} onChange={instruction => setEditing(current => current && { ...current, instruction })} multiline height={100} placeholder="Rewrite instructions" /></Stacked></>}
          <Stacked label="Model override"><Field id="profile-model" value={editing.openRouterModelID ?? ''} onChange={openRouterModelID => setEditing(current => current && { ...current, openRouterModelID })} placeholder="Leave empty to use the default model" /></Stacked>
          <Stacked label="Shortcut"><ShortcutField id="profile-shortcut" value={hotkeyLabel(editing.hotkey)} onRecord={shortcut => { try { setError(''); setEditing(current => current && { ...current, hotkey: toHotkey(shortcut), isEnabled: true }) } catch (cause) { setError(message(cause)) } }} onClear={() => setEditing(current => { if (!current) return current; const { hotkey: _, ...rest } = current; return { ...rest, isEnabled: false } })} /></Stacked>
          {profile.isBuiltIn ? null : <Row><Button onClick={() => void run(async () => { await speech().deleteProfile(profile.id); setEditing(null) })}>Delete profile</Button></Row>}
        </Column> : null}
      </div>)}
    </Column>
  </>
}

function NotesTab({ data, run }: { data: WritingState; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<WritingNote | null>(null)
  const [error, setError] = useState('')
  return <>
    <Intro text="Saved text you can paste anywhere with a shortcut."><Button id="write-new-note" onClick={() => void run(async () => setEditing(await speech().createNote({ title: 'New note', content: '' })))}>New note</Button></Intro>
    <ErrorText message={error} />
    <Column style={{ gap: 0 }}>
      {data.notes.map((note, index) => <div key={note.id} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderBottomWidth: 1, borderColor: C.line }}>
        <Row style={{ minHeight: space.control + 16, paddingLeft: space.inset }}>
          <Column style={{ flexGrow: 1, gap: 4 }}><Text>{note.title}</Text><Text muted size={11}>{note.hotkey ? hotkeyLabel(note.hotkey) : 'No shortcut'}</Text></Column>
          <Row style={{ gap: 0 }}><Button quiet onClick={() => copyText(note.content)}>Copy</Button>{editing?.id === note.id ? <Button id="note-save" primary onClick={() => void run(async () => setEditing(await speech().saveNote(editing)))}>Save</Button> : null}<Button quiet id={`write-note-edit-${index}`} onClick={() => setEditing(editing?.id === note.id ? null : note)}>{editing?.id === note.id ? 'Close' : 'Edit'}</Button></Row>
        </Row>
        {editing?.id === note.id ? <Column style={{ paddingLeft: space.inset, paddingRight: space.inset, paddingBottom: 16 }}>
          <Stacked label="Title"><Field id="note-title" value={editing.title} onChange={title => setEditing(current => current && { ...current, title })} placeholder="Note title" /></Stacked>
          <Stacked label="Text"><Field id="note-content" value={editing.content} onChange={content => setEditing(current => current && { ...current, content })} placeholder="Note text" multiline height={100} /></Stacked>
          <Stacked label="Shortcut"><ShortcutField id="note-shortcut" value={hotkeyLabel(editing.hotkey)} onRecord={shortcut => { try { setError(''); setEditing(current => current && { ...current, hotkey: toHotkey(shortcut) }) } catch (cause) { setError(message(cause)) } }} onClear={() => setEditing(current => { if (!current) return current; const { hotkey: _, ...rest } = current; return rest })} /></Stacked>
          <Row><Button onClick={() => void run(async () => { await speech().deleteNote(note.id); setEditing(null) })}>Delete note</Button></Row>
        </Column> : null}
      </div>)}
      {data.notes.length === 0 ? <Empty>No notes yet.</Empty> : null}
    </Column>
  </>
}

function SettingsTab({ data, shortcutsEnabled, run }: { data: WritingState; shortcutsEnabled: boolean; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [model, setModel] = useState(data.settings.rewriteProvider.modelID)
  return <>
    <Group title="Rewriting">
      <Setting label="Default model" detail="OpenRouter model ID. Profiles can override it."><div style={{ width: 260 }}><Field id="write-model" value={model} onChange={setModel} placeholder="OpenRouter model ID" /></div><Button id="write-save-model" disabled={model === data.settings.rewriteProvider.modelID} onClick={() => void run(() => speech().setWriteProvider({ kind: 'openRouter', modelID: model.trim() }))}>Save</Button></Setting>
      <Setting label="After rewriting selected text" detail="Applies when you use a profile shortcut in another app."><Choice id="write-output-mode" width={220} value={data.settings.outputMode} items={[{ value: 'replaceSelection', label: 'Replace the selection' }, { value: 'copyToClipboard', label: 'Copy to clipboard' }]} onChange={mode => void run(() => speech().setOutputMode(mode === 'copyToClipboard' ? 'copyToClipboard' : 'replaceSelection'))} /></Setting>
    </Group>
    <Group title="Shortcuts">
      <Setting label="Use profile and note shortcuts in every app" detail="Shared with Talk's shortcuts. Turn off BuddyWrite's shortcuts first."><Check id="write-shortcuts-enabled" label={shortcutsEnabled ? 'On' : 'Off'} checked={shortcutsEnabled} onChange={next => void run(() => setSpeechShortcuts(next))} /></Setting>
      <Setting label="OpenRouter key" detail="Shared with Talk."><Button onClick={() => nav.go('Talk', 'Settings')}>Open Talk settings</Button></Setting>
    </Group>
  </>
}
