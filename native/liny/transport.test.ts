import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { OcuMcpClient } from './agent/src/computer-use/mcp-client'

const stub = `#!/usr/bin/env bun
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
const namespace = process.env.OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE;
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);
 if(request.id===undefined)return;
 if(request.method==='tools/call' && request.params.name==='stall_once' && !existsSync(process.env.SYNTHETIC_STALL_MARKER)) {
  writeFileSync(process.env.SYNTHETIC_STALL_MARKER,'synthetic'); return;
 }
 const result=request.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'synthetic',version:'1'}}:{content:[{type:'text',text:JSON.stringify({namespace,pid:process.pid,visualCursor:process.env.OPEN_COMPUTER_USE_VISUAL_CURSOR})}],isError:false};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
`
test('OCU namespace preserves native parent monitoring and separates BuddyMac paths from original Liny', async () => {
 const root = await mkdtemp('/private/tmp/buddymac-ocu-transport-')
 const clients: OcuMcpClient[] = []
 try {
  const namespaces: string[] = []
  for (const name of ['installed-helper', 'development-helper']) {
   const binary = join(root, name)
   await writeFile(binary, stub); await chmod(binary, 0o700)
   const client = new OcuMcpClient(binary, 1_000, { ...process.env, OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE: 'foreign-namespace', OPEN_COMPUTER_USE_VISUAL_CURSOR: '1' })
   clients.push(client)
   const result = await client.callTool('read_synthetic_environment', {})
   const data = JSON.parse(result.content[0]!.text!)
   expect(data.namespace.startsWith('liny:')).toBe(true)
   expect(data.visualCursor).toBe('0')
   expect(data.namespace).toBe(`liny:buddymac:${binary}`)
   expect(data.namespace).not.toBe(`liny:${binary}`)
   namespaces.push(data.namespace)
  }
  expect(new Set(namespaces).size).toBe(2)
 } finally { for (const client of clients) await client.close(); await rm(root, { recursive: true, force: true }) }
})
test('transport timeout recycles its owned child before the next handshake', async () => {
 const root = await mkdtemp('/private/tmp/buddymac-ocu-recycle-')
 const binary = join(root, 'synthetic-helper')
 await writeFile(binary, stub); await chmod(binary, 0o700)
 const client = new OcuMcpClient(binary, 100, { ...process.env, SYNTHETIC_STALL_MARKER: join(root, 'stall-once') })
 try {
  const first = JSON.parse((await client.callTool('read_synthetic_environment', {})).content[0]!.text!)
  await expect(client.callTool('stall_once', {})).rejects.toThrow('must not be repeated without inspection')
  const recovered = JSON.parse((await client.callTool('read_synthetic_environment', {})).content[0]!.text!)
  expect(recovered.pid).not.toBe(first.pid)
  expect(recovered.namespace).toBe(first.namespace)
 } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})
