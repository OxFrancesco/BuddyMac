import { CString, dlopen, FFIType, ptr } from 'bun:ffi'
const library = dlopen(process.argv[2]!, {
 buddymac_notifications_start: { args:[FFIType.ptr], returns:FFIType.int },
 buddymac_notifications_take: { args:[FFIType.int], returns:FFIType.ptr },
 buddymac_notifications_cancel: { args:[FFIType.int], returns:FFIType.void },
 buddymac_notifications_free: { args:[FFIType.ptr], returns:FFIType.void },
})
const s=library.symbols
function read(id:number) {
 const pointer=s.buddymac_notifications_take(id)
 if(!pointer)return null
 try{return JSON.parse(new CString(pointer).toString())}finally{s.buddymac_notifications_free(pointer)}
}
async function request(payload:unknown) {
 const buffer=Buffer.from(JSON.stringify(payload)+'\0')
 const id=s.buddymac_notifications_start(ptr(buffer))
 const immediate=read(id)
 if(immediate)throw new Error('Fixture expected delayed callback execution')
 const deadline=Date.now()+2_000
 while(Date.now()<deadline){const result=read(id);if(result)return result;await Bun.sleep(5)}
 throw new Error('Queued native callbacks stalled without a main run loop')
}
const authorization=await request({operation:'authorize'})
const notification=await request({operation:'notify',notification:true,sound:false,title:'Synthetic callback fixture',message:'Fixture only'})
const status=await request({operation:'status'})
const cancelled=Buffer.from(JSON.stringify({operation:'authorize'})+'\0')
const cancelledID=s.buddymac_notifications_start(ptr(cancelled))
s.buddymac_notifications_cancel(cancelledID)
await Bun.sleep(80)
console.log(JSON.stringify({authorization,notification,status,cancelled:read(cancelledID)}))
library.close()
