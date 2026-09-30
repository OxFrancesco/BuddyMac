import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
async function fixture(mode:string,disabled:boolean){
 const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'fixture.ts'),mode],{env:{...process.env,BUDDYMAC_FOCUS_DISABLE_ALERTS:disabled?'1':'0'},stdout:'pipe',stderr:'pipe'})
 const [output,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
 expect(code).toBe(0)
 if(code!==0)throw new Error(error)
 return JSON.parse(output)
}
test('standalone process cannot request BuddyMac notification permission or trigger a prompt',async()=>{
 const {result,duplicate}=await fixture('authorize',false)
 expect(result.ok).toBe(false)
 expect(result.error).toContain('running BuddyMac app')
 expect(duplicate).toBeNull()
})
test('test-only bypass returns one consumable result without contacting notification service',async()=>{
 expect(await fixture('authorize',true)).toEqual({result:{ok:true,disabledForTest:true},duplicate:null})
})
test('native bridge rejects malformed input and releases cancelled replies',async()=>{
 expect((await fixture('malformed',true)).result.ok).toBe(false)
 expect(await fixture('cancel',true)).toEqual({result:null,duplicate:null})
})
