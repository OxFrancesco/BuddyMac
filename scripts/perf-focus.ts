import {launch} from '@gpuix/react/automation'
import {mkdir,mkdtemp,cp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {existsSync} from 'node:fs'
// Measures React commit time and CPU on the Focus page with a copy of the real Focus data: idle ticking, graph hover, typing.
const root=await mkdtemp('/private/tmp/buddymac-perf-')
const focusHome=join(root,'focus');await mkdir(focusHome,{recursive:true})
const real=join(process.env.HOME!,'Library/Application Support/BuddyMac/Focus')
for(const file of ['Focus.store','Focus.store-shm','Focus.store-wal'])if(existsSync(join(real,file)))await cp(join(real,file),join(focusHome,file))
const profile=join(root,'profile.json')
const env={...process.env,GPUIX_BACKGROUND:'1',BUDDYMAC_PROFILE:profile,BUDDYMAC_DATA_DIR:join(root,'data'),BUDDYMAC_FOCUS_HOME:focusHome,BUDDYMAC_FOCUS_DISABLE_ALERTS:'1',BUDDYMAC_SPEECH_DATA_DIR:join(root,'speech'),BUDDYMAC_LINY_HOME:join(root,'liny'),LINY_MOCK:'1',BUDDYMAC_LEGACY_FILES_DIR:join(root,'legacy'),BUDDYMAC_LEGACY_DOCK_MANIFEST:join(root,'none.json')}
await mkdir(env.BUDDYMAC_LEGACY_FILES_DIR,{recursive:true})
const app=await launch({command:process.execPath,args:['src/app.tsx'],env})
const cpu=async(seconds:number)=>{const samples:number[]=[];for(let i=0;i<seconds*2;i++){const out=await new Response(Bun.spawn(['/bin/ps','-A','-o','%cpu=,command='],{stdout:'pipe'}).stdout).text();samples.push(out.split('\n').filter(line=>line.includes('src/app.tsx')&&line.includes(profile.slice(0,0))).reduce((sum,line)=>sum+Number(line.trim().split(/\s+/)[0]),0));await Bun.sleep(500)}return samples.reduce((a,b)=>a+b,0)/samples.length}
const window=async(label:string,work:()=>Promise<unknown>)=>{const start=Date.now();const load=cpu(3);await work();const usage=await load;await Bun.sleep(1100);const list:{at:number;ms:number}[]=await Bun.file(profile).json();const slice=list.filter(c=>c.at>=start).map(c=>c.ms).sort((a,b)=>a-b);const total=slice.reduce((a,b)=>a+b,0);console.log(`${label.padEnd(12)} commits ${String(slice.length).padStart(4)}  total ${total.toFixed(0).padStart(5)}ms  p95 ${(slice[Math.floor(slice.length*0.95)]??0).toFixed(1).padStart(6)}ms  max ${(slice.at(-1)??0).toFixed(1).padStart(6)}ms  cpu ${usage.toFixed(0)}%`)}
try{
 if(process.argv.includes('--visit-all'))for(const section of ['Talk','Write','Dock','Liny','Settings']){await app.getByTestId(`nav-${section}`).click();await Bun.sleep(1500)}
 await app.getByTestId('nav-Focus').click();await app.getByTestId('timer-toggle').waitFor({timeoutMs:20000})
 await app.getByTestId('timer-toggle').click();await Bun.sleep(1000)
 await window('idle tick',()=>Bun.sleep(3000))
 await window('graph hover',async()=>{const box=await app.getByTestId('activity-graph').bounds();for(let i=0;i<30;i++){await app.mouse.move({x:box.x+30+i*((box.width-40)/30),y:box.y+10+(i%7)*12});await Bun.sleep(80)}})
 await window('typing',async()=>{const text='buy oat milk tomorrow';for(let i=1;i<=text.length;i++){await app.getByTestId('task-quick-add').fill(text.slice(0,i));await Bun.sleep(60)}})
 await app.getByTestId('timer-toggle').click()
}finally{await app.close()}
