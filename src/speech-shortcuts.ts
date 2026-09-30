import {homedir} from 'node:os'
import {dirname,join} from 'node:path'
import {mkdir,rename,chmod} from 'node:fs/promises'
import {speech} from './speech-state'
const path=()=>join(process.env.BUDDYMAC_SPEECH_DATA_DIR??join(homedir(),'Library/Application Support/BuddyMac/Speech'),'shortcuts-enabled.json')
export async function restoreSpeechShortcuts(){
 const file=Bun.file(path());if(!await file.exists())return
 const value:unknown=await file.json()
 if(typeof value!=='boolean')throw new Error('The saved shortcut setting is invalid.')
 if(value)await speech().enableShortcuts(true)
}
let saving:Promise<unknown>=Promise.resolve()
export function setSpeechShortcuts(enabled:boolean){
 const result=saving.then(async()=>{
  await speech().enableShortcuts(enabled)
  const destination=path();await mkdir(dirname(destination),{recursive:true,mode:0o700})
  const temporary=`${destination}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary,JSON.stringify(enabled));await chmod(temporary,0o600);await rename(temporary,destination)
 })
 saving=result.catch(()=>{});return result
}
