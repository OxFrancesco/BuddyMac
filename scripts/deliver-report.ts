import {resolve} from 'node:path'
const url=(await Bun.file('evidence/report-url.txt').text()).trim()
if(!url.startsWith('https://documents.buddytools.org/buddymac-gpuix-20260928/'))throw new Error('Unexpected report URL')
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const html=[
 '<b>Agent Codex is done with the BuddyMac build and installed-app checks in BuddyMac.</b>',
 '',
 'Installed: <code>~/Applications/BuddyMac.app</code>',
 'Files, Talk, Write, Focus, Dock and Liny. Jesty excluded. Frontend follows your design guidelines.',
 '19 service tests / 137 assertions; 11 native UI checks plus 4 final Focus checks. Live Codex inference and local S1 cleanup passed.',
 '',
 'Next: save an OpenRouter key in Talk Settings and grant microphone/Accessibility access when needed. Full feature parity and live computer-control checks remain incomplete; the report lists the gaps. Original apps and stores remain intact.',
 '',
 `<a href="${escape(url)}">Private report and recording</a>`,
].join('\n')
async function run(args:string[]){const child=Bun.spawn(['/Users/francescooddo/.local/bin/buddytg',...args],{stdout:'pipe',stderr:'pipe'});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);console.log(stdout);if(code!==0)throw new Error(stderr||`BuddyTG failed ${code}`);return stdout}
const file=await run(['file','send','me',resolve('evidence/buddymac-walkthrough.mp4'),'--confirm-to','904041730','--caption','BuddyMac native UI verification. Synthetic fixture data; no microphone recording or live icon changes.'])
const notification=await run(['notify','--html',html])
await Bun.write('evidence/telegram-delivery.json',JSON.stringify({sentAt:new Date().toISOString(),report:url,file,notification},null,2))
