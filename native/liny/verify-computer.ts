import { OcuMcpClient } from './agent/src/computer-use/mcp-client'
import { resolve } from 'node:path'
const target = 'org.buddytools.BuddyMacVerificationTarget'
const client = new OcuMcpClient(resolve(import.meta.dir, 'ocu/Open Computer Use.app/Contents/MacOS/OpenComputerUse'), 60_000)
const records: unknown[] = []
const call = async (name: string, args: unknown) => {
 console.log(JSON.stringify({phase:'start',name,pid:process.pid}))
 const started = Date.now()
 let sampler: ReturnType<typeof setTimeout> | undefined
 if(name==='run_actions') sampler=setTimeout(async()=>{
  const output=await new Response(Bun.spawn(['/bin/ps','-axo','pid,command'],{stdout:'pipe'}).stdout).text()
  const line=output.split('\n').find(line=>line.includes('/BuddyMac/native/liny/ocu/')&&line.includes('__open-computer-use-app-agent'))
  const pid=line?.trim().split(/\s+/)[0]
  if(pid){console.log(JSON.stringify({phase:'sample',pid}));await Bun.spawn(['/usr/bin/sample',pid,'2','-file','/private/tmp/buddymac-ocu-stall.sample.txt'],{stdout:'ignore',stderr:'inherit'}).exited}
 },3_000)
 try { const result = await client.callTool(name,args); const safe={...result,content:result.content.map(block=>block.type==='image'?{type:block.type,mimeType:block.mimeType,bytes:block.data?.length}:block)}; records.push({name,elapsedMs:Date.now()-started,result:safe}); console.log(JSON.stringify({phase:'done',name,elapsedMs:Date.now()-started,result:safe})); if(result.isError)throw new Error(`${name} reported a native failure`); return result }
 catch(error){records.push({name,elapsedMs:Date.now()-started,error:String(error)});console.log(JSON.stringify({phase:'error',name,error:String(error)}));throw error}finally{if(sampler)clearTimeout(sampler)}
}
try {
 await call('get_app_state',{app:target,screenshot:false})
 await call('query_state',{app:target,target:{identifier:'verification-text'}})
 await call('run_actions',{actions:[{tool:'set_value',app:target,target:{identifier:'verification-text'},value:'BUDDYMAC_COMPUTER_OK'},{tool:'assert',condition:{kind:'value',app:target,target:{identifier:'verification-text'},equals:'BUDDYMAC_COMPUTER_OK'}}],observation:'text'})
 const final=await call('query_state',{app:target,target:{identifier:'verification-text'}})
 const observed=JSON.parse(final.content.find(block=>block.type==='text')?.text??'{}')
 if(observed.element?.value!=='BUDDYMAC_COMPUTER_OK')throw new Error('Verification receiver value mismatch')
 const capture=await call('get_app_state',{app:target,screenshot:true})
 const image=capture.content.find(block=>block.type==='image')
 if(image?.data)await Bun.write(resolve(import.meta.dir,'../../evidence/live/computer-target.png'),Buffer.from(image.data,'base64'))
} finally {
 await Bun.write(resolve(import.meta.dir,'../../evidence/live/computer-direct.json'),JSON.stringify({verifiedAt:new Date().toISOString(),target,records},null,2))
 await client.close()
}
