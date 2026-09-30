import {useEffect,useState} from 'react'
import {SpeechClient,type SpeechEvent,type SpeechPhase,type SpeechStatus} from './speech'
let client:SpeechClient|null=null
const listeners=new Set<(event:SpeechEvent)=>void>()
const statusListeners=new Set<(status:SpeechStatus)=>void>()
export function speech(){return client??=new SpeechClient({onEvent:event=>{for(const listener of listeners)listener(event)}})}
export function closeSpeech(){client?.dispose();client=null}
export function onSpeechEvent(listener:(event:SpeechEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export function useSpeech(source:'talk'|'write'='talk'){
 const [status,setStatus]=useState<SpeechStatus|null>(null),[phase,setPhase]=useState<SpeechPhase>('idle'),[text,setText]=useState(''),[raw,setRaw]=useState(''),[error,setError]=useState(''),[level,setLevel]=useState(0),[resultVersion,setResultVersion]=useState(0)
 async function refresh(){try{const next=await speech().status();for(const listener of statusListeners)listener(next)}catch(e){setError(e instanceof Error?e.message:String(e))}}
 async function run(action:()=>Promise<unknown>){setError('');try{await action();await refresh()}catch(e){setError(e instanceof Error?e.message:String(e))}}
 useEffect(()=>{const update=(next:SpeechStatus)=>{setStatus(next);setPhase(next.phase)};statusListeners.add(update);void refresh();const handle=(event:SpeechEvent)=>{switch(event.event){case 'phase':setPhase(event.phase);if(event.phase==='idle'||event.phase==='success'||event.phase==='failed')void refresh();break;case 'level':setLevel(event.level);break;case 'result':if(event.source===source){setText(event.text);setRaw(event.rawText);setError(event.warning);setResultVersion(value=>value+1)}break;case 'error':setError(event.message);break}};listeners.add(handle);return()=>{listeners.delete(handle);statusListeners.delete(update)}},[source])
 return{status,phase,text,setText,raw,error,setError,level,resultVersion,run,refresh}
}
