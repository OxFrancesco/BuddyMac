export {}
const url=(await Bun.file('evidence/feature-report-url.txt').text()).trim()
if(url!=='https://documents.buddytools.org/buddymac-feature-verification-20260928/')throw new Error('Unexpected report URL')
const html=[
'<b>Agent Codex is done with the authorized verification pass in BuddyMac.</b>',
'',
'Installed GPUix app: Files, Talk, Write, Focus, Dock and Liny. Jesty excluded.',
'62 service tests, 567 assertions; 7 additional native UI workflows. Live cloud rewrite/transcription, microphone recording, file delivery and Focus notification readback passed.',
'Replacement OpenRouter key is in Keychain, with a $5 total cap and 90-day expiry.',
'',
'Accessibility and screen access remain off as requested. Main-app external insertion did not pass. Helper-based Liny control passed with receiver evidence. Full original feature parity remains incomplete; the report lists the gaps.',
'',
`<a href="${url}">Private report, evidence and recording</a>`,
].join('\n')
async function run(args:string[]){const p=Bun.spawn(['/Users/francescooddo/.local/bin/buddytg',...args],{stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw new Error(err);console.log(out);return out}
const video=await run(['file','send','me','/Volumes/T6-7/Coding/Personal/BuddyMac/evidence/buddymac-feature-walkthrough.mp4','--confirm-to','904041730','--caption','BuddyMac feature verification with isolated fixture data. Idle gaps shortened; cloud and permission checks have separate report evidence.'])
const notification=await run(['notify','--html',html])
await Bun.write('evidence/feature-telegram-delivery.json',JSON.stringify({sentAt:new Date().toISOString(),url,video,notification},null,2))
