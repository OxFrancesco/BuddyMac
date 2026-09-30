import {launch} from '@gpuix/react/automation'
import {mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=await mkdtemp('/private/tmp/buddymac-live-drag-')
const bin='/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS'
const env={...process.env,GPUIX_BACKGROUND:'1',BUDDYMAC_DATA_DIR:join(root,'data'),BUDDYMAC_FOCUS_HOME:join(root,'focus'),BUDDYMAC_SPEECH_DATA_DIR:join(root,'speech'),BUDDYMAC_LINY_HOME:join(root,'liny'),BUDDYMAC_LEGACY_FILES_DIR:join(root,'none'),BUDDYMAC_LEGACY_DOCK_MANIFEST:join(root,'none.json')}
const fixture=join(root,'Physical drop verification.txt');await Bun.write(fixture,'Receiver must copy this exact synthetic content.')
async function files(action:string,paths:string[]=[]){const p=Bun.spawn([join(bin,'buddymac-files')],{env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});p.stdin.write(JSON.stringify({action,paths}));p.stdin.end();const out=await new Response(p.stdout).json();assert.equal(await p.exited,0);return out}
await files('add',[fixture])
const app=await launch({command:join(bin,'BuddyMac'),args:[],env})
try{
 await app.getByTestId('file-Physical drop verification.txt').waitFor();await app.getByTestId('files-settings').click();await app.getByTestId('files-edge-right').click();await Bun.sleep(500);await app.getByTestId('files-edge-pin').click();await app.getByText('Unpin shelf').waitFor();await app.getByTestId('files-settings').click();await Bun.sleep(500)
 const bounds=await app.getByTestId('file-Physical drop verification.txt').bounds()
 await app.screenshot({path:resolve('evidence/live/files-before-drag.png')})
 const list=Bun.spawn(['dist/verification/verification-pointer','list'],{stdout:'pipe',stderr:'pipe'});const windows=await new Response(list.stdout).json();assert.equal(await list.exited,0)
 await Bun.write('evidence/live/drag-ready.json',JSON.stringify({root,fixture,bounds,windows},null,2));console.log('Native drag source ready')
 for(let i=0;i<240;i++){if(await Bun.file(join(root,'finish')).exists())break;await Bun.sleep(1000)}
 await app.screenshot({path:resolve('evidence/live/files-after-drag.png')});const shelf=await files('list');await Bun.write('evidence/live/drag-shelf-after.json',JSON.stringify(shelf,null,2))
}finally{await app.close()}
