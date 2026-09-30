import { OcuMcpClient } from '../agent/src/computer-use/mcp-client'
import { createComputerUseTools } from '../agent/src/computer-use/tools'
import { ComputerWorkflows } from '../agent/src/computer-use/workflows'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
const binary = process.env.BUDDYMAC_LINY_OCU_BIN, log = process.env.BUDDYMAC_LINY_TEST_OCU_LOG, home = process.env.BUDDYMAC_LINY_HOME
if (!binary || !log || !home) throw new Error('Synthetic fixture requires isolated paths')
let backend: OcuMcpClient | undefined
const tools = createComputerUseTools({ callTool: (name, args, signal) => {
 backend ??= new OcuMcpClient(binary, 5_000, process.env)
 return backend.callTool(name, args, signal)
} }, new ComputerWorkflows(join(home, 'workflows.json')))
try {
 if (existsSync(log)) throw new Error('Computer backend started before tool execution')
 const inspect = tools.tools.find(tool => tool.name === 'ocu_get_app_state')
 if (!inspect) throw new Error('Computer inspection tool missing')
 await inspect.execute('synthetic-call', { app: 'test.browser', screenshot: false }, new AbortController().signal)
 if (!existsSync(log)) throw new Error('Computer backend did not start on explicit tool execution')
} finally { await backend?.close() }
