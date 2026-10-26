// Memory soak for Camera against the signed bundle in dist/: twenty preview cycles and six recordings through the real UI.
// Prints the camera helper's and BuddyMac's physical footprint after each cycle and fails if either keeps growing.
// Usage: bun scripts/perf-camera.ts [path/to/BuddyMac.app]
import { launchInstalled } from './launch-installed'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const bundle = resolve(process.argv[2] ?? 'dist/BuddyMac.app')
await mkdir(resolve('dist'), { recursive: true })
const root = await mkdtemp(resolve('dist/camera-soak-'))
const data = join(root, 'data'), movies = join(root, 'Movies')
for (const directory of [join(data, 'Camera'), movies]) await mkdir(directory, { recursive: true })
await Bun.write(join(data, 'Camera/settings.json'), JSON.stringify({ folder: movies }))

const run = async (args: string[]) => { const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' }); const out = await new Response(child.stdout).text(); await child.exited; return out.trim() }
const pid = async (path: string) => Number((await run(['/usr/bin/pgrep', '-f', `${path}$`])).split('\n')[0] || 0)
async function megabytes(processId: number) {
  const match = (await run(['/usr/bin/footprint', '-p', String(processId)])).match(/phys_footprint:\s+([\d.]+) ([KMG])B/)
  if (!match) return 0
  return Number(match[1]) * (match[2] === 'G' ? 1024 : match[2] === 'K' ? 1 / 1024 : 1)
}

const app = await launchInstalled({ GPUIX_BACKGROUND: '1', BUDDYMAC_DATA_DIR: data, BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny') }, bundle)
const samples: { cycle: number; helper: number; app: number }[] = []
try {
  const appPid = await pid(join(bundle, 'Contents/MacOS/BuddyMac'))
  await app.getByTestId('nav-Camera').click()
  await app.getByTestId('camera-preview').waitFor({ timeoutMs: 20000 })
  const helperPid = await pid(join(bundle, 'Contents/MacOS/buddymac-camera'))
  for (let cycle = 1; cycle <= 20; cycle++) {
    await app.getByTestId('camera-preview').click()
    await app.getByTestId('camera-preview').getByText('Hide preview').waitFor({ timeoutMs: 20000 })
    await Bun.sleep(1500)
    if (cycle % 3 === 0) {
      await app.getByTestId('camera-record').click()
      await app.getByTestId('camera-record').getByText('Stop').waitFor({ timeoutMs: 15000 })
      await Bun.sleep(2500)
      await app.getByTestId('camera-record').click()
      await app.getByTestId('camera-record').getByText('Record').waitFor({ timeoutMs: 15000 })
    }
    await app.getByTestId('camera-preview').click()
    await app.getByTestId('camera-preview').getByText('Show preview').waitFor({ timeoutMs: 20000 })
    await Bun.sleep(800)
    samples.push({ cycle, helper: Math.round(await megabytes(helperPid)), app: Math.round(await megabytes(appPid)) })
    console.log(JSON.stringify(samples.at(-1)))
  }
  // Steady state is what matters: the first cycles load AVFoundation, the capture pipeline and the encoder once.
  const settled = samples.slice(10)
  const growth = (key: 'helper' | 'app') => settled.at(-1)![key] - settled[0]![key]
  const report = { helperGrowthMB: growth('helper'), appGrowthMB: growth('app'), samples }
  await mkdir(resolve('evidence/camera'), { recursive: true })
  await Bun.write(resolve('evidence/camera/memory-soak.json'), JSON.stringify({ measuredAt: new Date().toISOString(), bundle, ...report }, null, 2))
  console.log(JSON.stringify({ helperGrowthMB: report.helperGrowthMB, appGrowthMB: report.appGrowthMB }))
  assert(report.helperGrowthMB <= 15, `Camera helper grew ${report.helperGrowthMB} MB over the last ten cycles`)
  assert(report.appGrowthMB <= 15, `BuddyMac grew ${report.appGrowthMB} MB over the last ten cycles`)
} finally { await app.close() }
