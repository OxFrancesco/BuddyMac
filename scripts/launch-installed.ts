import {connectStdio} from '@gpuix/native/automation'
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {openSync,closeSync,writeSync,readSync,fstatSync,constants} from 'node:fs'
import {join} from 'node:path'
export async function launchInstalled(env:Record<string,string>={}){
 const root=await mkdtemp('/private/tmp/buddymac-launchservices-')
 const input=join(root,'stdin'),output=join(root,'stdout'),error=join(root,'stderr')
 const fifo=Bun.spawn(['/usr/bin/mkfifo','-m','600',input]);if(await fifo.exited!==0)throw new Error('Cannot create automation pipe')
 const inputFd=openSync(input,constants.O_RDWR)
 await writeFile(output,'',{mode:0o600});await writeFile(error,'',{mode:0o600})
 const outputFd=openSync(output,constants.O_RDONLY)
 const child=Bun.spawn(['/usr/bin/open','-n','-a','/Users/francescooddo/Applications/BuddyMac.app','--stdin',input,'--stdout',output,'--stderr',error,...Object.entries(env).flatMap(([key,value])=>['--env',`${key}=${value}`])],{stdout:'pipe',stderr:'pipe'})
 if(await child.exited!==0)throw new Error(await new Response(child.stderr).text())
 let offset=0,pid=0,timer:ReturnType<typeof setInterval>|undefined
 const app=await connectStdio({write:chunk=>{writeSync(inputFd,chunk)},feed:listener=>{timer=setInterval(()=>{const length=fstatSync(outputFd).size-offset;if(length<=0)return;const buffer=Buffer.alloc(length);const read=readSync(outputFd,buffer,0,length,offset);offset+=read;listener(buffer.subarray(0,read).toString('utf8'))},20)},close:async()=>{if(timer)clearInterval(timer);closeSync(inputFd);closeSync(outputFd);if(pid)try{process.kill(pid,'SIGTERM')}catch{}}})
 const initialized=await app.call('initialize',{protocolVersion:1,client:'BuddyMac LaunchServices verification'})
 pid=initialized.pid
 return app
}
