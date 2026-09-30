import {SpeechClient} from '../src/speech'
const client=new SpeechClient({binaryPath:process.env.BUDDYMAC_SPEECH_BINARY})
const start=Date.now()
try{
 const result=await client.rewrite({text:'hello francesco, the meeting is tomorrow at ten. please bring the notes.'})
 if(!result.text.trim())throw new Error('Provider returned empty text.')
 const evidence={verifiedAt:new Date().toISOString(),status:'passed',kind:'live OpenRouter rewrite with synthetic text',elapsedMs:Date.now()-start,text:result.text,delivery:result.delivery}
 await Bun.write('evidence/live/write.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence))
}catch(error){
 const evidence={verifiedAt:new Date().toISOString(),status:'blocked',kind:'live OpenRouter rewrite with synthetic text',elapsedMs:Date.now()-start,reason:error instanceof Error?error.message:String(error)}
 await Bun.write('evidence/live/write.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));process.exitCode=1
}finally{client.dispose()}
