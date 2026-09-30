import { useEffect, useRef, useState } from 'react'
import { useGpuix } from '@gpuix/react'
import { applyDockIcons, createDockPack, dockFailureMessage, dockStatus, getManaged, iconPreview, listDockApps, loadCurrentPack, loadSavedDockPack, refreshDock, relaunchApp, resetDockIcons, setCurrentPack, setManaged, type DockApp, type DockResult, type SavedDockPack } from './dock'
import { openSettingsPane } from './platform'
import { DockRecovery, needsAppManagement } from './dock-recovery'
import { tabs, useTab } from './nav'
import { Button, C, Column, Empty, ErrorText, Field, Group, Intro, Labeled, Row, Setting, TabbedPage, Text, space } from './ui'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function DockView() {
  const [tab, setTab] = useTab('Dock')
  const [apps, setApps] = useState<DockApp[]>([]), [pack, setPack] = useState<SavedDockPack | null>(null), [results, setResults] = useState<DockResult[]>([])
  const [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [managed, setManagedState] = useState<string[]>([]), [previews, setPreviews] = useState<Record<string, string>>({})
  const { renderer } = useGpuix()
  const retryIcons = useRef<() => Promise<void>>(async () => {})
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await work() } catch (cause) { setError(message(cause)) } finally { setBusy(false) } }
  async function changeIcons(action: 'apply' | 'reset', current: SavedDockPack, paths: string[]) {
    const next = await (action === 'apply' ? applyDockIcons(current, paths) : resetDockIcons(current, paths))
    if (action === 'reset') {
      const restored = next.filter(result => result.applied).map(result => result.appPath)
      const kept = managed.filter(path => !restored.includes(path))
      if (kept.length !== managed.length) { await setManaged(current, kept); setManagedState(kept) }
    }
    const status = await dockStatus(current)
    setResults(status.map(item => next.find(result => result.appPath === item.appPath && result.error) ?? item))
    if (next.some(result => result.changed)) await refreshDock()
    const failure = dockFailureMessage(next)
    if (failure) throw new Error(failure)
  }
  function startIcons(action: 'apply' | 'reset') {
    if (!pack) return
    retryIcons.current = () => changeIcons(action, pack, selected)
    void run(retryIcons.current)
  }
  async function show(next: SavedDockPack | null) {
    setPack(next); setSelected([])
    if (!next) return
    setResults(await dockStatus(next))
    setPreviews(Object.fromEntries(await Promise.all(next.icons.map(async icon => [icon.appPath, await iconPreview(icon.styledIconPath)]))))
  }
  async function refresh() {
    setApps(await listDockApps())
    const maintained = await getManaged()
    setManagedState(maintained?.icons.map(icon => icon.appPath) ?? [])
    await show(await loadCurrentPack() ?? maintained)
  }
  useEffect(() => { void run(refresh) }, [])
  const choosePack = () => void run(async () => {
    const paths = await renderer?.promptForPaths?.({ files: true, directories: false, multiple: false })
    if (!paths?.[0]) return
    const next = await loadSavedDockPack(paths[0])
    if (!next) throw new Error('Choose a BuddyDock manifest.json.')
    await setCurrentPack(paths[0]); await show(next)
  })
  const applicable = pack?.icons.filter(icon => icon.applyMethod === 'finder').map(icon => icon.appPath) ?? []
  const actions = <Row><Button onClick={() => void run(refresh)} disabled={busy}>Refresh</Button><Button id="dock-choose-pack" onClick={choosePack}>Choose pack</Button></Row>
  return <TabbedPage id="dock" title="Dock" items={tabs.Dock} tab={tab} onTab={setTab} actions={actions} scroll={tab !== 'Icons'}>
    {needsAppManagement(error) ? <DockRecovery error={error} retry={async () => { setBusy(true); try { await retryIcons.current() } finally { setBusy(false) } }} onError={setError} dismiss={() => setError('')} /> : <ErrorText message={error} />}
    {notice ? <Text muted>{notice}</Text> : null}
    {tab === 'Icons' ? <>
      {pack ? <Row style={{ flexShrink: 0, justifyContent: 'space-between' }}>
        <Text muted>{pack.theme}</Text>
        <Row><Button id="dock-select-all" disabled={!applicable.length} onClick={() => setSelected(selected.length === applicable.length ? [] : applicable)}>{selected.length === applicable.length && applicable.length ? 'Select none' : 'Select all'}</Button></Row>
      </Row> : <Empty>No icon pack yet. Choose a BuddyDock manifest or make one in New pack.</Empty>}
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflowY: 'scroll' }}>{(pack?.icons ?? apps).map(icon => {
        const saved = pack?.icons.find(item => item.appPath === icon.appPath)
        const status = results.find(item => item.appPath === icon.appPath)
        const external = saved?.applyMethod !== 'finder'
        const kept = managed.includes(icon.appPath)
        return <Row key={icon.appPath} style={{ flexShrink: 0, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.line }}>
          <Button quiet disabled={!saved || external} onClick={() => setSelected(previous => previous.includes(icon.appPath) ? previous.filter(path => path !== icon.appPath) : [...previous, icon.appPath])}>{selected.includes(icon.appPath) ? '✓' : '○'}</Button>
          {saved && !previews[icon.appPath] ? <div style={{ width: 44, height: 44, flexShrink: 0 }} /> : <img src={saved ? previews[icon.appPath] : icon.iconPath} objectFit="contain" style={{ width: 44, height: 44, flexShrink: 0 }} />}
          <Column style={{ flexGrow: 1, gap: 6 }}><Text size={14}>{icon.name}</Text><Text muted size={11}>{external && saved ? 'Set in the app\'s own settings' : status?.error && needsAppManagement(status.error) ? 'App Management access needed' : status?.error ? status.error.replace(/^./, first => first.toUpperCase()) : status?.applied ? `Applied${kept ? ' · kept applied' : ''}` : 'Not applied'}</Text></Column>
          {saved && !external ? <Button quiet onClick={() => void run(async () => { await relaunchApp(icon); setNotice(`${icon.name} reopened with its current icon.`) })}>Reopen app</Button> : null}
        </Row>
      })}</div>
      <Row style={{ flexWrap: 'wrap', flexShrink: 0 }}>
        <Button id="dock-apply" primary disabled={!pack || !selected.length || busy} onClick={() => startIcons('apply')}>Apply selected</Button>
        <Button id="dock-reset" disabled={!pack || !selected.length || busy} onClick={() => startIcons('reset')}>Restore original icons</Button>
        <Button id="dock-keep" disabled={!pack || !selected.length || busy} onClick={() => { if (pack) void run(async () => { const kept = [...new Set([...managed, ...selected])]; await setManaged(pack, kept); setManagedState(kept); setNotice('BuddyMac reapplies these icons every minute while it runs, for example after an app update.') }) }}>Keep selected applied</Button>
      </Row>
    </> : null}
    {tab === 'New pack' ? <NewPack apps={apps} busy={busy} run={run} renderer={renderer} onCreated={next => { void run(async () => { await show(next); setTab('Icons') }) }} /> : null}
    {tab === 'Settings' ? <>
      <Group title="Icon pack">
        <Setting label="Current pack" detail={pack?.path ?? 'None'}><Button onClick={choosePack}>Choose pack</Button></Setting>
        <Setting label="Keep icons applied" detail={managed.length ? `${managed.length === 1 ? 'One app is' : `${managed.length} apps are`} checked every minute and repaired after updates.` : 'Off. Select icons and press Keep selected applied.'}>{managed.length ? <Button id="dock-stop-keeping" disabled={busy} onClick={() => { if (pack) void run(async () => { await setManaged(pack, []); setManagedState([]) }) }}>Stop</Button> : null}</Setting>
      </Group>
      <Group title="macOS">
        <Setting label="App Management permission" detail="macOS asks for it before BuddyMac can change another app's icon."><Button onClick={() => openSettingsPane('appManagement')}>Open settings</Button></Setting>
        <Setting label="Refresh the Dock" detail="Restarts the Dock so it shows the current icons."><Button id="dock-refresh" disabled={busy} onClick={() => void run(refreshDock)}>Refresh Dock</Button></Setting>
      </Group>
    </> : null}
  </TabbedPage>
}

type Renderer = ReturnType<typeof useGpuix>['renderer']
function NewPack({ apps, busy, run, renderer, onCreated }: { apps: DockApp[]; busy: boolean; run: (work: () => Promise<void>) => Promise<void>; renderer: Renderer; onCreated: (pack: SavedDockPack) => void }) {
  const [name, setName] = useState(''), [images, setImages] = useState<Record<string, string>>({})
  const chosen = apps.filter(app => images[app.appPath])
  return <>
    <Intro text="Pick artwork for each app in your Dock. PNG or JPEG, ideally square and 1024 pixels. BuddyMac turns them into macOS icons." />
    <Row style={{ flexShrink: 0, alignItems: 'flex-end' }}><Labeled label="Pack name"><Field id="dock-pack-name" value={name} onChange={setName} placeholder="Claymation" /></Labeled><Button id="dock-create-pack" primary disabled={busy || !name.trim() || !chosen.length} onClick={() => void run(async () => onCreated(await createDockPack(name, chosen.map(app => ({ app, imagePath: images[app.appPath]! })))))}>{busy ? 'Creating' : 'Create pack'}</Button></Row>
    <Column style={{ gap: 0 }}>
      {apps.map(app => <Row key={app.appPath} style={{ flexShrink: 0, paddingTop: 12, paddingBottom: 12, paddingLeft: space.inset, borderBottomWidth: 1, borderColor: C.line }}>
        <img src={app.iconPath} objectFit="contain" style={{ width: 36, height: 36, flexShrink: 0 }} />
        {images[app.appPath] ? <img src={images[app.appPath]} objectFit="contain" style={{ width: 36, height: 36, flexShrink: 0 }} /> : <div style={{ width: 36, height: 36, flexShrink: 0, borderWidth: 1, borderColor: C.line }} />}
        <Column style={{ flexGrow: 1, gap: 4 }}><Text>{app.name}</Text><Text muted size={11}>{images[app.appPath]?.split('/').at(-1) ?? 'No artwork'}</Text></Column>
        <Row style={{ gap: 0 }}>
          {images[app.appPath] ? <Button quiet onClick={() => setImages(({ [app.appPath]: _, ...rest }) => rest)}>Remove</Button> : null}
          <Button quiet onClick={() => void run(async () => { const paths = await renderer?.promptForPaths?.({ files: true, directories: false, multiple: false }); const path = paths?.[0]; if (path) setImages(previous => ({ ...previous, [app.appPath]: path })) })}>Choose image</Button>
        </Row>
      </Row>)}
      {apps.length === 0 ? <Empty>No apps are pinned to your Dock.</Empty> : null}
    </Column>
  </>
}
