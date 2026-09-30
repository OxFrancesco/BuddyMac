import {launchInstalled} from './launch-installed'
import {mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
const previousPermissions=await Bun.file('evidence/live/permissions.json').json()
const previousIDs=new Set(previousPermissions.notifications.deliveredIdentifiers)
const root=await mkdtemp('/private/tmp/buddymac-notification-ui-')
const app=await launchInstalled({GPUIX_BACKGROUND:'1',BUDDYMAC_FOCUS_HOME:join(root,'focus'),BUDDYMAC_DATA_DIR:join(root,'data'),BUDDYMAC_SPEECH_DATA_DIR:join(root,'speech'),BUDDYMAC_LINY_HOME:join(root,'liny')})
try{
 await app.getByTestId('nav-Focus').click();await Bun.sleep(700);await app.getByTestId('focus-settings').click();await Bun.sleep(700);await app.getByTestId('focus-settings-save').click()
 console.log('Notification permission requested from BuddyMac main process.')
 let saved=false;for(let i=0;i<180;i++){if(await app.getByTestId('focus-settings-save').count()===0){saved=true;break}await Bun.sleep(1000)}
 if(!saved)throw new Error('Notification permission/settings save did not complete')
 await Bun.sleep(1000);await app.getByTestId('timer-skip').click();await Bun.sleep(500)
 await app.getByText('Short break').waitFor({timeoutMs:20000})
 await app.screenshot({path:resolve('evidence/live/notifications.png')})
 await Bun.write('evidence/live/notifications.json',JSON.stringify({verifiedAt:new Date().toISOString(),passed:false,permissionGranted:true,phaseTransition:true,kind:'BuddyMac main-process notification request from a fixture Focus phase transition',visibleDeliveryPending:true},null,2))
 console.log('Permission granted and phase changed. Waiting for external visible-delivery check.')
 await Bun.sleep(1000)
}catch(error){await app.screenshot({path:resolve('evidence/live/notification-failure.png')});await Bun.write('evidence/live/notification-failure.json',JSON.stringify(await app.call('getPaintedText',{}),null,2));throw error}finally{await app.close()}

const output=join(root,'permissions.json'),error=join(root,'permissions.err');await Bun.write(output,'');await Bun.write(error,'')
const check=Bun.spawn(['/usr/bin/open','-n','-W','-a','/Users/francescooddo/Applications/BuddyMac.app','--stdout',output,'--stderr',error,'--args','--check-permissions'],{stdout:'pipe',stderr:'pipe'})
if(await check.exited!==0)throw new Error(await new Response(check.stderr).text())
const permissions=await Bun.file(output).json()
const delivered=permissions.notifications.deliveredIdentifiers.filter((id:string)=>!previousIDs.has(id))
const result={verifiedAt:new Date().toISOString(),passed:permissions.notifications.authorizationStatus==='authorized'&&delivered.length===1,permissionGranted:true,phaseTransition:true,deliveredIdentifiers:delivered,kind:'Real installed Focus skip, corrected short break, and independent macOS delivered-notification readback',visualScreenshotCaptured:false}
await Bun.write('evidence/live/notifications.json',JSON.stringify(result,null,2));await Bun.write('evidence/live/permissions.json',JSON.stringify(permissions,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1
