import {useEffect,useState,useSyncExternalStore} from 'react'
import {SpeechClient,type SpeechEvent,type SpeechNeed,type SpeechPhase,type SpeechStatus} from './speech'
let client:SpeechClient|null=null
const listeners=new Set<(event:SpeechEvent)=>void>()
const statusListeners=new Set<(status:SpeechStatus)=>void>()
// Level arrives ~16 times a second while recording. It lives outside useSpeech so only meters re-render on it.
let level=0
const levelListeners=new Set<()=>void>()
function setLevel(next:number){if(next===level)return;level=next;for(const listener of levelListeners)listener()}
function subscribeLevel(listener:()=>void){levelListeners.add(listener);return()=>{levelListeners.delete(listener)}}
export function useSpeechLevel(){return useSyncExternalStore(subscribeLevel,()=>level)}
export function speech(){return client??=new SpeechClient({onEvent:event=>{if(event.event==='level')setLevel(event.level);else if(event.event==='phase'&&event.phase!=='recording')setLevel(0);for(const listener of listeners)listener(event)}})}
export function closeSpeech(){client?.dispose();client=null}
export function onSpeechEvent(listener:(event:SpeechEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export function useSpeech(source:'talk'|'write'='talk'){
 const [status,setStatus]=useState<SpeechStatus|null>(null),[phase,setPhase]=useState<SpeechPhase>('idle'),[text,setText]=useState(''),[raw,setRaw]=useState(''),[error,setError]=useState(''),[needs,setNeeds]=useState<SpeechNeed[]>([]),[resultVersion,setResultVersion]=useState(0)
 async function refresh(){try{const next=await speech().status();for(const listener of statusListeners)listener(next)}catch(e){setError(e instanceof Error?e.message:String(e))}}
 async function run(action:()=>Promise<unknown>){setError('');setNeeds([]);try{await action();await refresh()}catch(e){setError(e instanceof Error?e.message:String(e))}}
 useEffect(()=>{const update=(next:SpeechStatus)=>{setStatus(next);setPhase(next.phase)};statusListeners.add(update);void refresh();const handle=(event:SpeechEvent)=>{switch(event.event){case 'phase':setPhase(event.phase);if(event.phase==='idle'||event.phase==='success'||event.phase==='failed')void refresh();break;case 'result':if(event.source===source){setText(event.text);setRaw(event.rawText);setError(event.warning);setNeeds(event.needs);setResultVersion(value=>value+1)}break;case 'error':setError(event.message);setNeeds(event.needs);break}};listeners.add(handle);return()=>{listeners.delete(handle);statusListeners.delete(update)}},[source])
 return{status,phase,text,setText,raw,error,setError,needs,resultVersion,run,refresh}
}
