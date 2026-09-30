import {SpeechClient,type SpeechEvent} from '../src/speech'
import {mkdtemp} from 'node:fs/promises'
import {resolve} from 'node:path'
const directory=await mkdtemp('/private/tmp/buddymac-cloud-transcription-')
let receive:(e:SpeechEvent)=>void=()=>{}
const client=new SpeechClient({binaryPath:'/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS/buddymac-speech',onEvent:e=>receive(e)})
const started=Date.now()
const originalPreferences=await client.preferences()
const originalHistoryIds=new Set((await client.history()).map(e=>e.id))
try{
 const prefs=await client.preferences();await client.savePreferences({...prefs,autoPaste:false,screenContextEnabled:false,localCleanupEnabled:false,saveHistory:true,cleanupEnabled:true})
 const result=new Promise<SpeechEvent>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Transcription timed out')),120000);receive=e=>{if(e.event==='result'||e.event==='error'){clearTimeout(timer);resolve(e)}}})
 await client.importAudio(resolve('evidence/fixtures/speech.wav'))
 const event=await result
 const history=await client.history()
 const passed=event.event==='result'&&/meeting/i.test(event.text)&&/tomorrow/i.test(event.text)&&history.some(e=>e.text===event.text)
 const evidence={verifiedAt:new Date().toISOString(),passed,kind:'live OpenRouter audio import and cloud cleanup, synthetic speech fixture',elapsedMs:Date.now()-started,event,historySaved:history.some(e=>!originalHistoryIds.has(e.id)&&event.event==='result'&&e.text===event.text)}
 await Bun.write('evidence/live/transcription.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!passed)process.exitCode=1
}catch(error){const evidence={verifiedAt:new Date().toISOString(),passed:false,reason:error instanceof Error?error.message:String(error)};await Bun.write('evidence/live/transcription.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));process.exitCode=1}finally{try{await client.savePreferences(originalPreferences);for(const entry of await client.history())if(!originalHistoryIds.has(entry.id))await client.deleteHistory(entry.id)}finally{client.dispose()}}
