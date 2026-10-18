import { launch } from '@gpuix/react/automation'
import { mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// CPU of a hidden BuddyMac over 20 s, with isolated stores. Shows a second menu bar icon while it runs.
// `BUDDYMAC_IDLE_FRAME_MS=8 bun scripts/perf-idle.ts` measures the old fixed GPUix pacing for comparison.
const root = await mkdtemp('/private/tmp/buddymac-idle-')
const env = { ...process.env, BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'),
  BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny'),
  BUDDYMAC_LEGACY_FILES_DIR: join(root, 'no-legacy'), BUDDYMAC_LEGACY_DOCK_MANIFEST: join(root, 'no-pack.json') }
const packaged = process.env.BUDDYMAC_VERIFY_APP
const app = await launch({ command: packaged ?? process.execPath, args: packaged ? [] : [resolve('src/app.tsx')], env })
const { pid } = await app.call('initialize', { protocolVersion: 1, client: 'BuddyMac idle CPU' })
const cpu = async () => {
  const [minutes, seconds] = (await new Response(Bun.spawn(['ps', '-o', 'cputime=', '-p', String(pid)]).stdout).text()).trim().split(':')
  return Number(minutes) * 60 + Number(seconds)
}
try {
  await Bun.sleep(6000)
  const before = await cpu()
  await Bun.sleep(20000)
  console.log(JSON.stringify({ idleFrameMs: Number(process.env.BUDDYMAC_IDLE_FRAME_MS ?? 50), cpuPercent: +((await cpu() - before) / 20 * 100).toFixed(2) }))
} finally { await app.close() }
