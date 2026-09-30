import assert from 'node:assert/strict'
const source=await Bun.file('evidence/live/drag-ready.json').json()
const receiverRoot=(await Bun.file('evidence/live/receiver-root.txt').text()).trim()
const receiver=await Bun.file(receiverRoot+'/state.json').json()
const drop=receiver.drops.at(-1)
const result={verifiedAt:new Date().toISOString(),kind:'real macOS mouse drag into an independent native receiver',source:source.fixture,drop,passed:drop?.accepted===true}
await Bun.write('evidence/live/file-drag.json',JSON.stringify(result,null,2))
await Bun.write(source.root+'/finish','done')
assert(result.passed,'Receiver did not confirm delivery')
console.log(JSON.stringify(result))
