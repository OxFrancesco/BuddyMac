import {launch} from '@gpuix/react/automation'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve(process.argv[2]??'/private/tmp/buddymac-views')
const only=process.argv[3]
await mkdir(out,{recursive:true})
const root=await mkdtemp('/private/tmp/buddymac-views-data-')
const env={...process.env,GPUIX_BACKGROUND:'1',LINY_MOCK:'1',BUDDYMAC_DATA_DIR:join(root,'data'),BUDDYMAC_FOCUS_HOME:join(root,'focus'),BUDDYMAC_FOCUS_DISABLE_ALERTS:'1',BUDDYMAC_SPEECH_DATA_DIR:join(root,'speech'),BUDDYMAC_LINY_HOME:join(root,'liny'),BUDDYMAC_LINY_SOURCE_HOME:join(root,'liny-source'),BUDDYMAC_LEGACY_FILES_DIR:join(root,'legacy'),BUDDYMAC_LEGACY_DOCK_MANIFEST:join(root,'pack.json')}
await mkdir(env.BUDDYMAC_LEGACY_FILES_DIR,{recursive:true})
async function helper(path:string,args:string[],input?:unknown){const p=Bun.spawn([resolve(path),...args],{env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});if(input!==undefined)p.stdin.write(JSON.stringify(input));p.stdin.end();const [text,error,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);assert.equal(code,0,error);return text}
const files=['Quarterly plan.pdf','Project notes.txt','Screenshot 2026-09-28 at 18.42.png'].map(name=>join(root,name))
for(const path of files)await Bun.write(path,'BuddyMac layout fixture.')
await helper('dist/native/buddymac-files',[],{action:'add',paths:files})
const due=new Date(Date.now()+86_400_000).toISOString().slice(0,10)
const today=new Date();today.setHours(0,0,0,0);const yesterday=new Date(today.getTime()-86_400_000)
for(const task of [{title:'Review BuddyMac layout',notes:'',projectName:'BuddyMac',tags:['design'],priority:'p1',dueDate:today.toISOString()},{title:'Ship the NotchFlow port',notes:'',projectName:'BuddyMac',tags:[],priority:'p2',dueDate:yesterday.toISOString()},{title:'Plan next week',notes:'',projectName:'',tags:[],priority:'p3',dueDate:`${due}T12:00:00Z`},{title:'Reply to Telegram thread',notes:'',projectName:'',tags:[],priority:'p4'}])await helper('dist/buddymac-focus',['task-add'],task)
async function timed(command:string,at:number,input?:unknown){const p=Bun.spawn([resolve('dist/buddymac-focus'),command],{env:{...env,BUDDYMAC_FOCUS_TEST_NOW:String(at)},stdin:'pipe',stdout:'pipe',stderr:'pipe'});if(input!==undefined)p.stdin.write(JSON.stringify(input));p.stdin.end();assert.equal(await p.exited,0)}
const base=JSON.parse(await helper('dist/buddymac-focus',['snapshot'])).settings
await helper('dist/buddymac-focus',['settings'],{...base,workDurationMinutes:1})
for(const [daysAgo,count] of [[0,3],[1,2],[2,4],[5,1],[9,2],[16,5],[30,1],[44,3]]){for(let i=0;i<count;i++){const at=Date.now()/1000-daysAgo*86_400-i*300-60;await timed('timer-start',at);await timed('timer-tick',at+61);await timed('timer-skip',at+62)}}
await helper('dist/buddymac-focus',['settings'],base)
await helper('dist/buddymac-focus',['check-in'],{day:today.toISOString(),mood:4,text:'The notch panel works.'})
const target=join(root,'Fixture.app');await mkdir(join(target,'Contents/Resources'),{recursive:true})
await Bun.write(join(target,'Contents/Info.plist'),'<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>')
const icon='/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
await Bun.write(env.BUDDYMAC_LEGACY_DOCK_MANIFEST,JSON.stringify({version:1,theme:'Monochrome',icons:[{id:'a',name:'Fixture app',appPath:target,bundleIdentifier:null,iconPath:icon,styledIconPath:icon}]}))
await Bun.write(join(env.BUDDYMAC_DATA_DIR,'Dock/settings.json'),JSON.stringify({packPath:env.BUDDYMAC_LEGACY_DOCK_MANIFEST}))
const app=await launch({command:process.execPath,args:['src/app.tsx'],env})
const shot=async(name:string)=>{if(only&&!name.includes(only))return;await Bun.sleep(700);await app.screenshot({path:join(out,`${name}.png`)});console.log(name)}
const tab=async(section:string,name:string)=>{await app.getByTestId(`${section}-tab-${name}`).click();await Bun.sleep(300)}
try{
 await app.getByTestId('file-Project notes.txt').waitFor({timeoutMs:20000});await shot('files-shelf')
 await app.getByTestId('file-Project notes.txt').click();await shot('files-selected')
 await tab('files','settings');await shot('files-settings');await tab('files','shelf')
 await app.getByTestId('nav-Talk').click();await app.getByTestId('talk-record').waitFor();await shot('talk-record')
 for(const name of ['history','dictionary','snippets','style','shortcuts','settings']){await tab('talk',name);await shot(`talk-${name}`)}
 await tab('talk','dictionary');await app.getByTestId('talk-add-word').click();await shot('talk-dictionary-dirty');await app.getByTestId('talk-discard').click()
 await tab('talk','record')
 await app.getByTestId('nav-Write').click();await app.getByTestId('write-input').waitFor();await app.getByTestId('write-input').fill('Can you make this sound less stiff?');await shot('write-rewrite')
 await tab('write','profiles');await app.getByTestId('write-new-profile').click();await shot('write-profiles-new');await app.getByTestId('write-template-formal').click();await Bun.sleep(800);await shot('write-profiles-edit')
 await tab('write','notes');await shot('write-notes');await tab('write','settings');await shot('write-settings');await tab('write','rewrite')
 await app.getByTestId('nav-Focus').click();await app.getByTestId('task-search').waitFor({timeoutMs:15000});await shot('focus-tasks')
 await app.getByTestId('task-filter-upcoming').click();await shot('focus-tasks-soon');await app.getByTestId('task-filter-all').click()
 await app.getByTestId('task-new').click();await shot('focus-editor');await app.getByTestId('task-cancel').click()
 for(const name of ['history','check-ins','settings']){await tab('focus',name);await shot(`focus-${name}`)}
 await tab('focus','tasks')
 await app.getByTestId('checkin-button').click();await shot('focus-checkin-popover');await app.getByTestId('checkin-cancel').click()
 await app.getByTestId('focus-compact').click();await app.getByTestId('compact-focus').waitFor();await shot('compact-focus');await app.getByTestId('compact-expand').click();await Bun.sleep(400)
 await app.getByTestId('nav-search').click();await app.getByTestId('palette-input').waitFor();await app.getByTestId('palette-input').fill('focus panel');await app.getByTestId('palette-item-0').click();await app.getByTestId('focus-panel').waitFor();await shot('notch-panel');await app.getByTestId('panel-expand').click();await Bun.sleep(500)
 await app.getByTestId('nav-Dock').click();await app.getByText('Fixture app').waitFor({timeoutMs:15000});await shot('dock-icons')
 await tab('dock','new-pack');await shot('dock-new-pack');await tab('dock','settings');await shot('dock-settings');await tab('dock','icons')
 await app.getByTestId('nav-Liny').click();await app.getByTestId('liny-input').waitFor();await shot('liny-chat-empty')
 await app.getByTestId('liny-input').fill('/');await shot('liny-slash');await app.getByTestId('liny-input').fill('Summarize my open tasks');await app.getByTestId('liny-send').click()
 for(let i=0;i<40&&!(await app.call('getPaintedText',{})).text.some((value:string)=>value.includes('[mock]'));i++)await Bun.sleep(250)
 await shot('liny-chat')
 for(const name of ['history','memory','settings']){await tab('liny',name);await shot(`liny-${name}`)}
 await tab('liny','chat')
 await app.getByTestId('nav-Settings').click();await Bun.sleep(500);await shot('settings-general')
 for(const name of ['permissions','shortcuts','original-apps']){await tab('settings',name);await Bun.sleep(800);await shot(`settings-${name}`)}
 await app.getByTestId('nav-search').click();await app.getByTestId('palette-input').waitFor();await app.getByTestId('palette-input').fill('dict');await shot('palette')
 await app.getByTestId('palette-item-0').click();await Bun.sleep(400);await shot('palette-result')
 await app.getByTestId('nav-Talk').click();await Bun.sleep(500);await app.getByTestId('talk-compact').click();await app.getByTestId('compact-talk').waitFor();await shot('compact-talk');await app.getByTestId('compact-expand').click()
}finally{await app.close()}
