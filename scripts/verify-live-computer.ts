import {LinyClient,type LinyEvent} from '../src/liny'
const liny=new LinyClient({command:['/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS/BuddyMac','--liny-worker']})
const root=(await Bun.file('evidence/live/receiver-root.txt').text()).trim()
const target=await Bun.file(root+'/state.json').json()
const expected='BUDDYMAC_COMPUTER_'+Date.now()
let originalId='',reply='',unsubscribe=()=>{}
const events:LinyEvent[]=[]
const started=Date.now()
try{
 originalId=(await liny.snapshot()).id
 await liny.reset()
 const completion=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Computer test timed out')),150_000);unsubscribe=liny.onEvent(event=>{if(event.event==='tool.activity')events.push(event);if(event.event==='delta')reply+=event.text;if(event.event==='turn.done'){clearTimeout(timer);resolve()}if(event.event==='turn.error'){clearTimeout(timer);reject(new Error(event.message))}})})
 const sending=liny.send(`This is a user-authorized live verification. Use your native computer tools ONLY on the already open app named BuddyMac Verification Target, PID ${target.pid}, bundle org.buddytools.BuddyMacVerificationTarget. Do not inspect or control any other app or browser, do not request new permissions, and do not use screenshots of the whole desktop. Read its editable text, replace its entire value using set_value with exactly ${expected}. Then read the text again and report it. Do not modify any files or other windows.`,[],{tools:'computer'})
 await Promise.all([sending,completion])
 const after=await Bun.file(root+'/state.json').json()
 const result={verifiedAt:new Date().toISOString(),elapsedMs:Date.now()-started,passed:after.text===expected&&after.text!==target.text,reply,toolEvents:events,receiverText:after.text}
 await Bun.write('evidence/live/computer.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
 if(!result.passed)process.exitCode=1
}catch(error){const result={verifiedAt:new Date().toISOString(),passed:false,reason:error instanceof Error?error.message:String(error),reply,toolEvents:events};await Bun.write('evidence/live/computer.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=1}
finally{unsubscribe();try{await liny.abort();if(originalId)await liny.resume(originalId)}finally{liny.close()}}
