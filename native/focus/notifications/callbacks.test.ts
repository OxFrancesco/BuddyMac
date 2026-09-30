import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
let home = '', library = ''
beforeAll(async()=>{
 home=await mkdtemp('/private/tmp/buddymac-notification-callbacks-');library=join(home,'fixture.dylib')
 const child=Bun.spawn(['swiftc','-module-cache-path','/private/tmp/buddymac-swift-module-cache','-O','-swift-version','6','-DNOTIFICATIONS_TESTING','-emit-library',resolve(import.meta.dir,'Notifications.swift'),resolve(import.meta.dir,'CallbacksFixture.swift'),'-o',library],{stdout:'pipe',stderr:'pipe'})
 const [error,code]=await Promise.all([new Response(child.stderr).text(),child.exited])
 if(code!==0)throw new Error(error)
},30_000)
afterAll(async()=>{if(home)await rm(home,{recursive:true,force:true})})
async function run(scenario:string){
 const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'callback-fixture.ts'),library],{env:{...process.env,BUDDYMAC_FOCUS_DISABLE_ALERTS:'0',BUDDYMAC_NOTIFICATION_SCENARIO:scenario},stdout:'pipe',stderr:'pipe'})
 const [output,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
 if(code!==0)throw new Error(error)
 return JSON.parse(output)
}
test('native callbacks authorize, schedule, query delivery and cancel without any AppKit or Swift main-loop pump',async()=>{
 const result=await run('success')
 expect(result.authorization.ok).toBe(true)
 expect(result.notification.ok).toBe(true)
 expect(result.status.authorizationStatus).toBe('authorized')
 expect(result.status.deliveredIdentifiers).toEqual([result.notification.notificationID])
 expect(result.cancelled).toBeNull()
})
test('denied authorization prevents native scheduling and is reported without waiting for a timeout',async()=>{
 const result=await run('denied')
 expect(result.authorization.ok).toBe(false)
 expect(result.authorization.error).toContain('disabled')
 expect(result.notification.ok).toBe(false)
 expect(result.status.deliveredIdentifiers).toEqual([])
})
test('authorization and scheduling service errors survive their asynchronous callback boundaries',async()=>{
 const authorization=await run('authorizationError')
 expect(authorization.authorization).toMatchObject({ok:false,domain:'SyntheticNotifications',code:41})
 const delivery=await run('deliveryError')
 expect(delivery.notification).toMatchObject({ok:false,domain:'SyntheticNotifications',code:42})
 expect(delivery.status.deliveredIdentifiers).toEqual([])
})
