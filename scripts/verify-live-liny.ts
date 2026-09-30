import {liny} from '../src/liny'
const started=Date.now()
let reply=''
try{
 const sources=await liny.importSources()
 const candidates=sources.sources.filter(source=>source.sessionFiles>0)
 const active=process.env.BUDDYMAC_LINY_PROFILE?sources.sources.find(source=>source.id===process.env.BUDDYMAC_LINY_PROFILE):candidates.length===1?candidates[0]:undefined
 if(!active)throw new Error('The previously inspected active Liny profile is unavailable.')
 await liny.importSource(active.id,true)
 const state=await liny.state()
 const original=await liny.snapshot()
 const test=await liny.reset()
 let unsubscribe=()=>{}
 const completion=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Live Liny turn timed out')),90_000);unsubscribe=liny.onEvent(event=>{if(event.event==='delta')reply+=event.text;if(event.event==='turn.done'){clearTimeout(timeout);resolve()}if(event.event==='turn.error'){clearTimeout(timeout);reject(new Error(event.message))}})})
 try{await liny.send('Reply exactly BUDDYMAC_OK. This is a synthetic integration test. Do not call tools or change anything.',[],{tools:'none'});await completion;if(!reply.includes('BUDDYMAC_OK'))throw new Error('The provider did not return the expected synthetic reply.')}finally{unsubscribe();await liny.abort();if(original.id)await liny.resume(original.id)}
 const result={verifiedAt:new Date().toISOString(),kind:'live Liny personal-provider inference with synthetic prompt',provider:state.provider,model:state.model,elapsedMs:Date.now()-started,reply,sessionId:test.id}
 await Bun.write('evidence/live/liny.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{liny.close()}
