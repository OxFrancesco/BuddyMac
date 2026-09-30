import {launchInstalled} from './launch-installed'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const app=await launchInstalled({GPUIX_BACKGROUND:'1'})
try{
 await app.getByTestId('nav-Talk').click();await app.getByTestId('talk-search').fill('BuddyMac verification fixture only');await Bun.sleep(750);await app.getByTestId('talk-record').waitFor();await app.getByTestId('talk-record').click()
 console.log('Microphone request started. Waiting for permission and recording UI.')
 await app.getByText('Listening').waitFor({timeoutMs:120000})
 await app.screenshot({path:resolve('evidence/live/microphone-recording.png')})
 await Bun.sleep(5000)
 await app.getByText('Cancel').click()
 await app.getByText('Ready to dictate').waitFor({timeoutMs:15000})
 await app.screenshot({path:resolve('evidence/live/microphone-cancelled.png')})
 await Bun.write('evidence/live/microphone.json',JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,kind:'Installed app microphone start, five-second capture and cancellation',recordingUi:true,cancelReturnedIdle:true,uploaded:false},null,2))
 console.log('Microphone capture and cancellation passed.')
}catch(error){await app.screenshot({path:resolve('evidence/live/microphone-failure.png')});await Bun.write('evidence/live/microphone.json',JSON.stringify({verifiedAt:new Date().toISOString(),passed:false,error:error instanceof Error?error.message:String(error),painted:await app.call('getPaintedText',{})},null,2));throw error}finally{await app.close()}
