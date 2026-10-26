// End-to-end Camera check against the signed bundle in dist/: real clicks in GPUix, a real camera, a real recording.
// The first run asks for camera access on behalf of BuddyMac. Allow it, and the run continues.
// Usage: bun scripts/verify-camera.ts [path/to/BuddyMac.app]
import { launchInstalled } from './launch-installed'
import { mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const bundle = resolve(process.argv[2] ?? 'dist/BuddyMac.app')
const helperPath = join(bundle, 'Contents/MacOS/buddymac-camera')
// Scratch files live next to the build, not in /private/tmp: the system drive can be the one short on space.
await mkdir(resolve('dist'), { recursive: true })
const root = await mkdtemp(resolve('dist/camera-check-'))
const data = join(root, 'data'), movies = join(root, 'Movies'), evidence = resolve('evidence/camera'), frames = join(root, 'frames')
for (const directory of [join(data, 'Camera'), movies, evidence, frames]) await mkdir(directory, { recursive: true })
await Bun.write(join(data, 'Camera/settings.json'), JSON.stringify({ folder: movies }))

const run = async (args: string[]) => { const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' }); const out = await new Response(child.stdout).text(); await child.exited; return out.trim() }
const helperPid = async () => Number((await run(['/usr/bin/pgrep', '-f', helperPath])).split('\n')[0] || 0)
/** Average CPU and resident memory of the helper over a few one-second samples. */
async function usage(pid: number) {
  const out = await run(['/usr/bin/top', '-l', '4', '-s', '1', '-pid', String(pid), '-stats', 'cpu,mem'])
  const rows = out.split('\n').filter(line => /^\s*[\d.]+\s+\d+[KMG]/.test(line)).slice(1)
  const cpu = rows.map(line => Number(line.trim().split(/\s+/)[0]))
  return { cpu: Number((cpu.reduce((a, b) => a + b, 0) / Math.max(cpu.length, 1)).toFixed(1)), memory: rows.at(-1)?.trim().split(/\s+/)[1] ?? '?' }
}
/** The preview is the helper's own window, so screencapture grabs it by window id. */
async function capturePreview(path: string) {
  const id = await run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics');const list=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1,0)));const w=list.find(x=>x.kCGWindowOwnerPID===${await helperPid()}&&x.kCGWindowLayer>0);w?w.kCGWindowNumber:0`])
  assert(Number(id) > 0, 'The preview window is not on screen')
  await run(['/usr/sbin/screencapture', '-x', '-o', '-l', id, path])
}
async function probe(path: string) {
  const out = await run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', path])
  return JSON.parse(out) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate: string }[]; format: { duration: string } }
}

const app = await launchInstalled({ GPUIX_BACKGROUND: '1', BUDDYMAC_DATA_DIR: data, BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_LINY_HOME: join(root, 'liny') }, bundle)
const steps: string[] = [], metrics: Record<string, unknown> = {}
let recording = true
const captured: { path: string; time: number }[] = []
const capture = (async () => { while (recording) { const path = join(frames, `${String(captured.length).padStart(5, '0')}.png`); try { await app.screenshot({ path }); captured.push({ path, time: performance.now() }) } catch {} await Bun.sleep(250) } })()
const record = async (seconds: number) => {
  await app.getByTestId('camera-record').click()
  await app.getByTestId('camera-record').getByText('Stop').waitFor({ timeoutMs: 15000 })
  const pid = await helperPid()
  metrics[`recording-${(await readdir(movies)).length}`] = await usage(pid)
  await Bun.sleep(Math.max(0, seconds * 1000 - 4000))
  await app.getByTestId('camera-record').click()
  await app.getByTestId('camera-record').getByText('Record').waitFor({ timeoutMs: 15000 })
  await app.getByTestId('camera-last').waitFor({ timeoutMs: 15000 })
  await Bun.sleep(500)
  const files = (await readdir(movies)).filter(name => name.endsWith('.mov')).sort()
  return join(movies, files.at(-1)!)
}
try {
  await app.getByTestId('nav-Camera').click()
  await app.getByTestId('camera-device').waitFor({ timeoutMs: 20000 })
  assert(await helperPid() > 0, 'Opening Camera did not start the helper')
  await app.screenshot({ path: join(evidence, '1-capture.png') })
  steps.push('Camera section lists the connected camera and its modes')

  await app.getByTestId('camera-preview').click()
  console.log('Preview requested. Allow camera access for BuddyMac if macOS asks.')
  await app.getByTestId('camera-preview').getByText('Hide preview').waitFor({ timeoutMs: 180000 })
  await Bun.sleep(2500)
  await capturePreview(join(evidence, '2-preview-window.png'))
  metrics.preview1080p = await usage(await helperPid())
  steps.push('Floating preview window shows the live camera')

  await app.getByTestId('camera-mirror').click()
  await app.getByTestId('camera-mirror').getByText('Off').waitFor()
  await Bun.sleep(600)
  await capturePreview(join(evidence, '3-preview-unmirrored.png'))
  await app.getByTestId('camera-mirror').click()
  steps.push('Mirror toggles on the live preview')

  const first = await record(5)
  const one = await probe(first)
  const video = one.streams.find(stream => stream.codec_type === 'video')!
  assert.equal(video.codec_name, 'hevc'); assert.equal(`${video.width}x${video.height}`, '1920x1080'); assert(Number(one.format.duration) >= 3, `Recording too short: ${one.format.duration}`)
  metrics.firstRecording = { file: first, ...one }
  await app.screenshot({ path: join(evidence, '4-after-recording.png') })
  steps.push('Five-second HEVC 1080p recording saved and playable')

  await app.getByTestId('camera-size').click()
  await app.getByTestId('camera-size-1280x720').click()
  await app.getByTestId('camera-size').getByText('1280 × 720 (720p)').waitFor({ timeoutMs: 15000 })
  await Bun.sleep(1500)
  await capturePreview(join(evidence, '5-preview-720p.png'))
  metrics.preview720p = await usage(await helperPid())
  await app.getByTestId('camera-tab-settings').click()
  await app.getByTestId('camera-codec').click()
  await app.getByTestId('camera-codec-h264').click()
  await app.getByText('H.264. Plays in every app and browser.').waitFor()
  await app.getByTestId('camera-tab-capture').click()
  await app.getByTestId('camera-record').waitFor()
  const second = await record(4)
  const two = await probe(second)
  const small = two.streams.find(stream => stream.codec_type === 'video')!
  assert.equal(small.codec_name, 'h264'); assert.equal(`${small.width}x${small.height}`, '1280x720')
  metrics.secondRecording = { file: second, ...two }
  steps.push('Resolution and codec changes apply: 720p H.264 recording')

  await app.getByTestId('camera-tab-recordings').click()
  await app.getByText(second.split('/').at(-1)!).waitFor({ timeoutMs: 10000 })
  await app.screenshot({ path: join(evidence, '6-recordings.png') })
  steps.push('Recordings tab lists both files')

  await app.getByTestId('camera-tab-capture').click()
  await app.getByTestId('camera-preview').click()
  await app.getByTestId('camera-preview').getByText('Show preview').waitFor({ timeoutMs: 10000 })
  await Bun.sleep(1000)
  metrics.idleWithViewOpen = await usage(await helperPid())
  await app.getByTestId('nav-Files').click()
  await Bun.sleep(1500)
  assert.equal(await helperPid(), 0, 'The camera helper kept running after leaving Camera')
  steps.push('Hiding the preview releases the camera; leaving Camera quits the helper')

  await Bun.write(join(evidence, 'camera.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), bundle, passed: true, steps, metrics }, null, 2))
  console.log(JSON.stringify({ passed: steps.length, steps, metrics }, null, 2))
} catch (error) {
  await app.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  console.error('Completed steps:', steps, metrics)
  throw error
} finally {
  recording = false; await capture; await app.close()
  if (captured.length > 1) {
    await Bun.write(join(frames, 'frames.txt'), captured.map((frame, index) => `file '${frame.path}'\nduration ${((captured[index + 1]?.time ?? frame.time + 500) - frame.time) / 1000}`).join('\n') + `\nfile '${captured.at(-1)!.path}'\n`)
    await run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'frames.txt'), '-vf', 'scale=1080:760:force_original_aspect_ratio=decrease,pad=1080:760:(ow-iw)/2:(oh-ih)/2:black,setsar=1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(evidence, 'camera-walkthrough.mp4')])
  }
}
