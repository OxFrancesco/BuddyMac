import { mkdtemp, mkdir, readFile, appendFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createModels, fauxProvider, fauxAssistantMessage, type ImageModel } from '@earendil-works/pi-ai'
import { DurableInference, type InferenceJob } from '../src/durable-inference'

const mode = process.argv[2]
if (mode === 'child') {
  const directory = process.argv[3]!, kind = process.argv[4]!, slow = process.argv[5] === 'slow'
  const models = createModels()
  const faux = fauxProvider({ models: [{ id: 'fixture', name: 'Fixture', input: ['text'], contextWindow: 4096 }], tokensPerSecond: 1000 })
  faux.setResponses([async () => { await appendFile(join(directory, 'calls.txt'), 'chat\n'); process.stdout.write('started\n'); if (slow) await new Promise(resolve => setTimeout(resolve, 30_000)); return fauxAssistantMessage('Recovered text.') }])
  const image: ImageModel<'openrouter-images'> = { type: 'image', id: 'image', name: 'Image fixture', api: 'openrouter-images', provider: 'faux', baseUrl: 'https://fixture.invalid', input: ['text'], output: ['image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  models.setProvider({ ...faux.provider, getAllModels: () => [...faux.provider.getModels(), image], generateImages: async () => { await appendFile(join(directory, 'calls.txt'), 'image\n'); process.stdout.write('started\n'); if (slow) await new Promise(resolve => setTimeout(resolve, 30_000)); return { api: image.api, provider: 'faux', model: 'image', stopReason: 'stop', timestamp: 1, output: [{ type: 'image', mimeType: 'image/png', data: Buffer.from(await Bun.file(resolve('assets/ducky/frame-00.png')).arrayBuffer()).toString('base64') }] } } })
  const engine = new DurableInference(join(directory, 'store'), models)
  const job: InferenceJob = kind === 'image' ? { kind: 'image', provider: 'faux', model: 'image', prompt: 'One fixture icon.' } : { kind: 'chat', provider: 'faux', model: 'fixture', context: { messages: [{ role: 'user', content: 'One fixture reply.', timestamp: 1 }] } }
  const signal = process.argv[6] === 'cancel' ? AbortSignal.timeout(1000) : undefined
  try { const result = await engine.run(job, { requestId: 'stable', signal }); console.log(JSON.stringify({ completed: result.kind })) }
  catch (cause) { console.log(JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) })) }
  finally { await engine.close() }
  process.exit(0)
}

const root = await mkdtemp('/private/tmp/buddymac-pi-recovery-')
const checks: string[] = []
function child(directory: string, kind: string, speed = 'fast', cancel = '') { return Bun.spawn([process.execPath, import.meta.path, 'child', directory, kind, speed, cancel], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } }) }
async function finish(process: ReturnType<typeof child>) { const [output, error, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]); assert.equal(code, 0, error); return output }
async function crashed(directory: string, kind: string) {
  await mkdir(directory)
  const process = child(directory, kind, 'slow')
  const reader = process.stdout.getReader()
  let output = ''
  while (!output.includes('started')) { const read = await reader.read(); assert(!read.done, 'Provider fixture must start before interruption.'); output += new TextDecoder().decode(read.value) }
  const concurrent = await finish(child(directory, kind))
  assert(concurrent.includes('already open'), concurrent)
  process.kill('SIGKILL'); await process.exited; reader.releaseLock()
}
const text = join(root, 'text')
await crashed(text, 'chat')
assert((await finish(child(text, 'chat'))).includes('"completed":"chat"'))
assert.equal((await readFile(join(text, 'calls.txt'), 'utf8')).trim().split('\n').length, 2)
assert((await finish(child(text, 'chat'))).includes('"completed":"chat"'))
assert.equal((await readFile(join(text, 'calls.txt'), 'utf8')).trim().split('\n').length, 2)
checks.push('A killed text job resumes; completed output is reused without a third provider request.')
const image = join(root, 'image')
await crashed(image, 'image')
assert((await finish(child(image, 'image'))).includes('was not sent again'))
assert.equal((await readFile(join(image, 'calls.txt'), 'utf8')).trim(), 'image')
checks.push('An image request interrupted after dispatch causes no second provider dispatch during recovery.')
checks.push('A second process cannot open a store owned by a live process.')
const cancelled = join(root, 'cancelled'); await mkdir(cancelled)
assert((await finish(child(cancelled, 'chat', 'slow', 'cancel'))).includes('error'))
assert((await finish(child(cancelled, 'chat'))).includes('cancelled'))
assert.equal((await readFile(join(cancelled, 'calls.txt'), 'utf8')).trim(), 'chat')
checks.push('Cancellation is persisted and reopening does not restart the cancelled request.')
assert.equal((await stat(join(text, 'store/journal'))).mode & 0o077, 0)
checks.push('The durable journal directory is private to the current macOS user.')
await mkdir('evidence/pi', { recursive: true })
await Bun.write('evidence/pi/recovery.json', JSON.stringify({ verifiedAt: new Date().toISOString(), root, kind: 'end-to-end process interruption with real Pi Durable storage and provider fixtures', checks, limits: ['Text recovery may repeat a provider call whose response had not been committed.', 'Image recovery intentionally reports an uncertain outcome rather than repeating a paid request.'] }, null, 2))
console.log(JSON.stringify({ passed: checks.length, checks }))
