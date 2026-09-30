#!/usr/bin/env bun
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
if (process.env.BUDDYMAC_LINY_TEST_OCU_LOG) appendFileSync(process.env.BUDDYMAC_LINY_TEST_OCU_LOG, 'synthetic OCU started\n')
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'Synthetic OCU fixture', version: '1' } }
    : { content: [], isError: false, structuredContent: { name: 'Synthetic browser', bundleIdentifier: 'test.browser', path: '/synthetic/Browser.app' } }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
lines.on('close', () => process.exit(0))
