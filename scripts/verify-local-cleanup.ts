import {mkdtemp,mkdir,symlink} from 'node:fs/promises'
import {SpeechClient} from '../src/speech'
const data=await mkdtemp('/private/tmp/buddymac-local-cleanup-')
await mkdir(`${data}/models`)
await symlink('/Users/francescooddo/Library/Application Support/BuddyTalk/models/s1-mini-q4_k_m.gguf',`${data}/models/s1-mini-q4_k_m.gguf`)
const client=new SpeechClient({binaryPath:'/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS/buddymac-speech',dataDirectory:data})
try{
 const status=await client.status();if(!status.localModelPresent)throw new Error('Cached local cleanup model unavailable; no download attempted.')
 await client.savePreferences({...await client.preferences(),language:'en',style:'natural'})
 const started=Date.now();const output=await client.normalizeLocally('um hello world')
 if(!output.toLowerCase().includes('hello world'))throw new Error('Unexpected local cleanup response.')
 const evidence={verifiedAt:new Date().toISOString(),kind:'installed signed speech helper with real cached S1-mini model',input:'um hello world',output,elapsedMs:Date.now()-started,network:false,microphone:false}
 await Bun.write('evidence/live/local-cleanup.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence))
}finally{client.dispose()}
