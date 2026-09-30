import {resolve,sep} from 'node:path'
const root=resolve('report')
Bun.serve({hostname:'127.0.0.1',port:9187,fetch(request){const path=resolve(root,decodeURIComponent(new URL(request.url).pathname).slice(1)||'index.html');if(!path.startsWith(root+sep))return new Response('Forbidden',{status:403});return new Response(Bun.file(path))}})
console.log('Report preview: http://127.0.0.1:9187')
