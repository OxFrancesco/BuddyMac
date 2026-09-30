import {SpeechClient,type SpeechEvent} from '../src/speech'
import {mkdtemp} from 'node:fs/promises'
const root=(await Bun.file('evidence/live/receiver-root.txt').text()).trim()
const state=await Bun.file(root+'/state.json').json()
const data=await mkdtemp('/private/tmp/buddymac-note-test-')
let listener:(event:SpeechEvent)=>void=()=>{}
const c=new SpeechClient({binaryPath:'/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS/buddymac-speech',dataDirectory:data,onEvent:event=>listener(event)})
let off=()=>{}
async function clipboard(){const p=Bun.spawn(['/usr/bin/pbpaste'],{stdout:'pipe'});return new Response(p.stdout).text()}
const previousClipboard=await clipboard()
const expected='BUDDYMAC_NOTE_'+Date.now()
try{
 const prefs=await c.preferences()
 const combo=(keyCode:number)=>({keyCode,modifiers:6912,keyLabel:'Fixture'})
 await c.savePreferences({...prefs,autoPaste:true,restoreClipboard:true,shortcuts:{hold:combo(105),toggle:combo(107),edit:combo(113),cancel:combo(106)}})
 const note=await c.createNote({title:'Fixture insertion',content:expected})
 await c.saveNote({...note,hotkey:{keyCode:0,modifiersRawValue:1966080}})
 const focus=Bun.spawn(['dist/verification/verification-target-ax',String(state.pid),'select-all'],{stdout:'pipe',stderr:'pipe'});if(await focus.exited!==0)throw new Error(await new Response(focus.stderr).text())
 await c.enableShortcuts(true)
 const result=new Promise<SpeechEvent>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Note shortcut did not produce a result')),12_000);listener=event=>{if(event.event==='result'||event.event==='error'){clearTimeout(timeout);resolve(event)}};off=()=>{listener=()=>{}}})
 const key=Bun.spawn(['dist/verification/fixture-key'],{stdout:'pipe',stderr:'pipe'});if(await key.exited!==0)throw new Error(await new Response(key.stderr).text())
 const event=await result
 const after=await Bun.file(root+'/state.json').json()
 const evidence={verifiedAt:new Date().toISOString(),kind:'real global note shortcut and captured-target insertion',passed:after.text===expected&&after.text!==state.text,clipboardPreserved:(await clipboard())===previousClipboard,event,receiverText:after.text}
 await Bun.write('evidence/live/note-insertion.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1
}catch(error){const evidence={verifiedAt:new Date().toISOString(),passed:false,reason:error instanceof Error?error.message:String(error)};await Bun.write('evidence/live/note-insertion.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));process.exitCode=1}finally{off();try{await c.enableShortcuts(false)}finally{c.dispose()}}
