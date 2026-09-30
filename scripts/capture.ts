import { launch } from '@gpuix/react/automation'
import { mkdirSync } from 'node:fs'
mkdirSync('evidence',{recursive:true})
const app=await launch({command:process.execPath,args:['src/app.tsx'],env:{GPUIX_BACKGROUND:'1',BUDDYMAC_DATA_DIR:process.cwd()+'/evidence/fixture-data',BUDDYMAC_FOCUS_HOME:process.cwd()+'/evidence/fixture-data/Focus',BUDDYMAC_LEGACY_FILES_DIR:process.cwd()+'/evidence/no-legacy'}})
try {
 await app.getByTestId('nav-Files').waitFor({timeoutMs:15000})
 await app.screenshot({path:process.cwd()+'/evidence/buddymac-progress.png'})
} finally {await app.close()}
