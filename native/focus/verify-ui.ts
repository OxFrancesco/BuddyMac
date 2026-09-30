import { launch } from '@gpuix/react/automation'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root = await mkdtemp('/private/tmp/buddymac-focus-ui-')
const env = { ...process.env, GPUIX_BACKGROUND: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_FOCUS_DISABLE_ALERTS: '1', BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'), BUDDYMAC_LEGACY_FILES_DIR: join(root, 'none'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'no-pack.json') }
async function call(command: string, payload?: unknown, now?: number) {
 const child = Bun.spawn([resolve('dist/buddymac-focus'), command], { env: { ...env, ...(now === undefined ? {} : { BUDDYMAC_FOCUS_TEST_NOW: String(now) }) }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
 if (payload !== undefined) child.stdin.write(JSON.stringify(payload)); child.stdin.end()
 const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]); assert.equal(code, 0); return JSON.parse(out)
}
const draft = {title:'Review the release notes',notes:'Synthetic verification task',projectName:'BuddyMac',tags:['release'],priority:'p2'}
const seeded = await call('task-add',draft); const id = seeded.tasks[0].id
await call('task-add',{...draft,title:'Package the native helpers'})
await call('settings',{...seeded.settings,workDurationMinutes:1,notificationsEnabled:false,playSoundOnTransitions:false})
await call('timer-reset'); const now=Math.floor(Date.now()/1000);await call('timer-start',undefined,now-61);await call('timer-tick',undefined,now)
await call('check-in',{day:new Date().toISOString(),mood:4,text:'A quiet morning to finish the release.'})
await mkdir('evidence',{recursive:true})
const executable=process.env.BUDDYMAC_VERIFY_APP
const app=await launch({command:executable??process.execPath,args:executable?[]:['src/app.tsx'],env})
try {
 await app.getByTestId('nav-Focus').click();await app.getByTestId(`edit-${id}`).waitFor({timeoutMs:20000})
 await app.getByTestId(`edit-${id}`).click();await app.getByTestId('task-move-down').click();await app.getByTestId('task-cancel').click()
 const reordered = await call('snapshot'); assert.equal(reordered.tasks[1].id,id)
 await app.screenshot({path:resolve('evidence/buddymac-focus-tasks.png')})
 await app.getByTestId('focus-tab-history').click();await app.getByText('1 min today').waitFor();await app.screenshot({path:resolve('evidence/buddymac-focus-history.png')})
 await app.getByTestId('focus-tab-check-ins').click();await app.getByTestId('focus-checkin').click();await app.getByTestId('checkin-text').fill('A verified check-in edit.');await app.getByTestId('checkin-save').click();await app.getByText('A verified check-in edit.').waitFor();await app.screenshot({path:resolve('evidence/buddymac-focus-checkins.png')})
 await app.getByTestId('timer-toggle').click();await app.getByText('Pause').waitFor();const running=await call('snapshot');await app.getByTestId('nav-Files').click();await Bun.sleep(2100);await app.getByTestId('nav-Focus').click();const after=await call('snapshot');assert(after.remainingSeconds<running.remainingSeconds);await app.getByTestId('timer-toggle').click()
 const result={verifiedAt:new Date().toISOString(),executable:executable??'source',passed:true,kind:'native GPUix with isolated synthetic data',checks:['task order persisted','history and analytics rendered','check-in edit persisted','timer continued during navigation']}
 await Bun.write('evidence/focus-ui-verification.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result))
} finally {await app.close()}
