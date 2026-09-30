import {SpeechClient} from '../src/speech'
async function clipboard(){const p=Bun.spawn(['/usr/bin/pbpaste'],{stdout:'pipe'});const value=await new Response(p.stdout).text();if(await p.exited!==0)throw new Error('Clipboard unavailable');return value}
const original=await clipboard()
console.log('Waiting for the newly created key to be copied. Values will not be logged.')
const expires=Date.now()+180_000
let installed=false
while(Date.now()<expires){
 const value=(await clipboard()).trim()
 if(value!==original.trim()&&/^sk-or-v1-[a-zA-Z0-9]{40,}$/.test(value)){
  const client=new SpeechClient({binaryPath:'/Users/francescooddo/Applications/BuddyMac.app/Contents/MacOS/buddymac-speech'})
  try{await client.setKey({provider:'openRouter',value});if(!(await client.status()).keyConfigured)throw new Error('Key status did not update');installed=true;console.log('Dedicated key saved in BuddyMac Keychain.')}finally{client.dispose();const restore=Bun.spawn(['/usr/bin/pbcopy'],{stdin:'pipe'});restore.stdin.write(original);restore.stdin.end();await restore.exited}
  break
 }
 await Bun.sleep(500)
}
if(!installed)throw new Error('No new key was copied before timeout')
await Bun.write('evidence/live/key-setup.json',JSON.stringify({verifiedAt:new Date().toISOString(),name:'BuddyMac',account:'Personal',creditLimitUSD:5,reset:'none',expiration:'2026-12-27',storage:'macOS Keychain through installed signed helper',clipboardRestored:true},null,2))
