import { CString, dlopen, FFIType, ptr } from 'bun:ffi'
import { resolve } from 'node:path'
const library = dlopen(resolve(import.meta.dir, '../../../dist/libbuddymac-notifications.dylib'), {
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
const input=Buffer.from((process.argv[2]==='malformed'?'invalid-json':JSON.stringify({operation:'authorize'}))+'\0')
const id=s.buddymac_notifications_start(ptr(input))
if(process.argv[2]==='cancel')s.buddymac_notifications_cancel(id)
const result=read(id), duplicate=read(id)
console.log(JSON.stringify({result,duplicate}))
library.close()
