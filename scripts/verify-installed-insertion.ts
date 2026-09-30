import {SpeechClient} from '../src/speech'
import {launchInstalled} from './launch-installed'
import {mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=await mkdtemp('/private/tmp/buddymac-app-insertion-'),data=join(root,'speech')
const receiver=(await Bun.file('evidence/live/receiver-root.txt').text()).trim()
const state=await Bun.file(join(receiver,'state.json')).json()
const expected='BUDDYMAC_APP_INSERT_'+Date.now()
const c=new SpeechClient({binaryPath:'/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS/buddymac-speech',dataDirectory:data})
try{const p=await c.preferences();const combo=(keyCode:number)=>({keyCode,modifiers:6912,keyLabel:'Fixture'});await c.savePreferences({...p,autoPaste:true,restoreClipboard:true,shortcuts:{hold:combo(105),toggle:combo(107),edit:combo(113),cancel:combo(106)}});const n=await c.createNote({title:'Fixture insertion',content:expected});await c.saveNote({...n,hotkey:{keyCode:0,modifiersRawValue:1966080}})}finally{c.dispose()}
async function clipboard(){const p=Bun.spawn(['/usr/bin/pbpaste'],{stdout:'pipe'});return new Response(p.stdout).text()}
const before=await clipboard()
const app=await launchInstalled({GPUIX_BACKGROUND:'1',BUDDYMAC_SPEECH_DATA_DIR:data,BUDDYMAC_DATA_DIR:join(root,'data'),BUDDYMAC_LINY_HOME:join(root,'liny'),BUDDYMAC_FOCUS_HOME:join(root,'focus')})
try{
 await app.getByTestId('nav-Talk').click();await Bun.sleep(750);const compact=await app.getByTestId('talk-compact').bounds();const settings=(await app.getByText('Settings').all()).filter(n=>n.bounds&&n.bounds.width>0&&n.bounds.x>compact.x&&Math.abs(n.bounds.y-compact.y)<10).sort((a,b)=>a.bounds!.x-b.bounds!.x)[0];if(!settings?.bounds)throw new Error('Talk Settings not located');await app.mouse.click({x:settings.bounds.x+settings.bounds.width/2,y:settings.bounds.y+settings.bounds.height/2});await Bun.sleep(750);await app.getByText('Enable dictation shortcuts').click();await app.getByText('Disable shortcuts').waitFor({timeoutMs:10000})
 const focus=Bun.spawn(['dist/verification/verification-target-ax',String(state.pid),'select-all'],{stdout:'pipe',stderr:'pipe'});assert.equal(await focus.exited,0)
 const key=Bun.spawn(['dist/verification/fixture-key'],{stdout:'pipe',stderr:'pipe'});assert.equal(await key.exited,0)
 let after=state;for(let i=0;i<40;i++){after=await Bun.file(join(receiver,'state.json')).json();if(after.text===expected)break;await Bun.sleep(250)}
 const result={verifiedAt:new Date().toISOString(),passed:after.text===expected&&after.text!==state.text,clipboardPreserved:await clipboard()===before,kind:'LaunchServices-installed BuddyMac owns the global note shortcut and external Accessibility insertion',receiverText:after.text}
 await Bun.write('evidence/live/installed-insertion.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert(result.passed);assert(result.clipboardPreserved)
 await app.screenshot({path:resolve('evidence/live/installed-insertion.png')})
}finally{try{if(await app.getByText('Disable shortcuts').count()===1)await app.getByText('Disable shortcuts').click()}finally{await app.close()}}
