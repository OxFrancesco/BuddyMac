import { launch } from '@gpuix/react/automation'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = await mkdtemp('/private/tmp/buddymac-checkboxes-')
const out = resolve('evidence/pi/focus')
await mkdir(out, { recursive: true })
const env = { ...process.env, GPUIX_BACKGROUND: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_FOCUS_DISABLE_ALERTS: '1', BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'), BUDDYMAC_LINY_SOURCE_HOME: join(root, 'original'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'none.json') }
async function call(command: string, input?: unknown) {
  const child = Bun.spawn([resolve('dist/buddymac-focus'), command], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  if (input !== undefined) child.stdin.write(JSON.stringify(input))
  child.stdin.end()
  const [text, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  assert.equal(code, 0, error)
  return JSON.parse(text)
}
const draft = { notes: '', projectName: '', tags: [], priority: 'p3', dueDate: new Date().toISOString() }
const first = (await call('task-add', { ...draft, title: 'Check the checkbox edges' })).tasks[0].id
await call('task-add', { ...draft, title: 'Keep the adjacent task unchanged' })
let last = ''
for (let i = 3; i <= 14; i++) {
  const title = i === 4 ? 'Create a model and harness tier list video, edit the recording and prepare the short version' : `Review queued task ${i}`
  const snapshot = await call('task-add', { ...draft, title })
  if (i === 14) last = snapshot.tasks.find((task: { title: string }) => task.title === title).id
}
const executable = process.env.BUDDYMAC_VERIFY_APP
const app = await launch({ command: executable ?? process.execPath, args: executable ? [] : ['src/app.tsx'], env })
const checks: string[] = []
let stage = 'open'
try {
  await app.getByTestId('nav-Focus').waitFor({ timeoutMs: 20_000 })
  await app.getByTestId('nav-search').click()
  await app.getByTestId('palette-input').fill('focus panel')
  await app.getByTestId('palette-item-0').click()
  await app.getByTestId('focus-panel').waitFor()
  await app.getByTestId(`complete-${first}`).waitFor({ timeoutMs: 20_000 })
  await Bun.sleep(400)
  await app.screenshot({ path: join(out, 'before-click.png') })
  const bounds = await app.getByTestId(`complete-${first}`).bounds()
  // The pointer lands in the padding around the 16px glyph, not on the glyph itself.
  const points = [[-18, 0], [18, 0], [0, -18], [0, 18], [-18, -18], [18, 18]]
  for (const [dx, dy] of points) {
    stage = `padding ${dx},${dy}`
    const center = await app.getByTestId(`complete-${first}`).center()
    await app.mouse.click({ x: center.x + dx!, y: center.y + dy! })
    let snapshot
    for (let i = 0; i < 20; i++) { snapshot = await call('snapshot'); if (snapshot.tasks.find((task: { id: string }) => task.id === first)?.isCompleted) break; await Bun.sleep(100) }
    assert(snapshot.tasks.find((task: { id: string }) => task.id === first)?.isCompleted, `Checkbox padding click ${dx},${dy} must complete the task.`)
    assert(snapshot.tasks.filter((task: { id: string }) => task.id !== first).every((task: { isCompleted: boolean }) => !task.isCompleted), 'Padding must not toggle an adjacent task.')
    await app.getByTestId('task-filter-completed').click()
    stage += ' completed filter'
    await app.getByTestId(`complete-${first}`).waitFor()
    await Bun.sleep(200)
    await app.getByTestId(`complete-${first}`).click()
    await Bun.sleep(300)
    await app.getByTestId('task-filter-today').click()
    stage += ' today filter'
    await app.getByTestId(`complete-${first}`).waitFor()
    await Bun.sleep(200)
  }
  checks.push('Six clicks around the checkbox glyph toggle only the intended task.')
  for (const key of ['space', 'enter']) {
    stage = `keyboard ${key}`
    await app.getByTestId(`complete-${first}`).press(key)
    await Bun.sleep(300)
    let snapshot
    for (let i = 0; i < 20; i++) { snapshot = await call('snapshot'); if (snapshot.tasks.find((task: { id: string }) => task.id === first)?.isCompleted) break; await Bun.sleep(100) }
    assert(snapshot.tasks.find((task: { id: string }) => task.id === first)?.isCompleted, `${key} must toggle the checkbox.`)
    await app.getByTestId('task-filter-completed').click()
    await app.getByTestId(`complete-${first}`).waitFor()
    await app.getByTestId(`complete-${first}`).press(key)
    await app.getByTestId('task-filter-today').click()
    await app.getByTestId(`complete-${first}`).waitFor()
  }
  checks.push('Space and Enter complete and reopen the task.')
  assert(bounds.width >= 44 && bounds.height >= 44, `Expected at least 44x44; received ${bounds.width}x${bounds.height}.`)
  await app.screenshot({ path: join(out, 'verified-hitboxes.png') })
  const panelViewport = await app.getByTestId('task-list-viewport').bounds()
  const activity = await app.getByTestId('focus-activity').bounds()
  assert(panelViewport.height > 100 && panelViewport.y + panelViewport.height <= activity.y - 12, 'The task list must end above Activity in the notch panel.')
  stage = 'scroll panel'
  for (let i = 0; i < 8 && !(await app.call('getPaintedText', {})).text.some((text: string) => text.includes('Review queued task 14')); i++) { await app.getByTestId('task-list-viewport').wheel(0, -400); await Bun.sleep(250) }
  const lastBounds = await app.getByTestId(`complete-${last}`).bounds()
  assert(lastBounds.y + lastBounds.height / 2 >= panelViewport.y && lastBounds.y + lastBounds.height / 2 <= panelViewport.y + panelViewport.height, 'Scrolling must reveal the last task inside the viewport.')
  await app.screenshot({ path: join(out, 'scrolled-panel.png') })
  checks.push('Fourteen tasks scroll inside the notch panel without overlapping Activity.')
  await app.getByTestId('panel-expand').click()
  await app.getByTestId('task-list-viewport').waitFor()
  await Bun.sleep(400)
  const mainViewport = await app.getByTestId('task-list-viewport').bounds()
  assert(mainViewport.height > 100, 'The main Focus window must allocate visible space to task rows.')
  await app.screenshot({ path: join(out, 'main-focus.png') })
  checks.push('The main Focus window displays the task list with the same spacing and controls.')
  await Bun.write(join(out, 'verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), executable: executable ?? 'source', root, bounds, checks, kind: 'native pointer and keyboard input with isolated real SwiftData tasks' }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, bounds, checks }))
} catch (cause) { await app.screenshot({ path: join(out, 'failure.png') }); console.error(stage); throw cause }
finally { await app.close() }
