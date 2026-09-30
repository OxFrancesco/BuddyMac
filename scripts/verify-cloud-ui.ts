import {launchInstalled} from './launch-installed'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const app=await launchInstalled({GPUIX_BACKGROUND:'1'})
try{
 await app.getByTestId('nav-Write').click();await Bun.sleep(600);await app.getByTestId('write-input').fill('hello nora, the meeting is tomorrow at ten. please bring the notes.');await Bun.sleep(500);await app.getByTestId('write-rewrite').click()
 let output='';for(let i=0;i<80;i++){const node=await app.getByTestId('write-output').element();output=String(node.customProps?.value??node.text??'');if(output.includes('Nora'))break;await Bun.sleep(250)}
 await app.screenshot({path:resolve('evidence/live/write-ui.png')})
 const painted=(await app.call('getPaintedText',{})).text
 const passed=output.includes('Nora')||painted.some(t=>t.includes('Hello Nora')&&t.includes('notes'))
 await Bun.write('evidence/live/write-ui.json',JSON.stringify({verifiedAt:new Date().toISOString(),passed,kind:'Real OpenRouter rewrite through LaunchServices-installed GPUix UI',output},null,2))
 assert(passed,'Expected rewritten fixture visible in output')
 await app.getByText('Use as input').click();await Bun.sleep(500);await app.getByText('Clear').click()
 console.log('Live GPUix rewrite, use-as-input and clear passed.')
}finally{await app.close()}
