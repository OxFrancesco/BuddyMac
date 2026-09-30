import { z } from 'zod'
const provider = z.enum(['openai-codex', 'openrouter', 'zai', 'liny'])
const thinking = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const message = z.object({ role: z.enum(['user', 'assistant']), text: z.string(), hasImages: z.boolean().optional() })
export const snapshotSchema = z.object({ id: z.string(), provider, model: z.string(), thinking, messages: z.array(message) })
export const sessionsSchema = z.object({ currentId: z.string(), sessions: z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.number() })) })
export const stateSchema = z.object({
  computerBackend: z.enum(['ocu', 'stagehand']), loggedIn: z.boolean(), authSource: z.string().optional(), provider, model: z.string(), thinking, sessionTurns: z.number(),
  providers: z.array(z.object({ id: provider, name: z.string(), authMethods: z.array(z.enum(['api_key', 'oauth'])), loggedIn: z.boolean(), authSource: z.string().optional() })),
  models: z.array(z.object({ provider, id: z.string(), name: z.string(), contextWindow: z.number(), vision: z.boolean() })),
})
export const sourcesSchema = z.object({ sources: z.array(z.object({ id: z.string(), label: z.string(), sessionFiles: z.number(), hasMemory: z.boolean() })), activeProfile: z.string(), mode: z.literal('personal'), managedBilling: z.literal(false) })
const usage = z.object({ input: z.number(), output: z.number(), total: z.number() })
export const eventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('turn.started') }), z.object({ event: z.literal('delta'), text: z.string() }),
  z.object({ event: z.literal('turn.done'), usage: usage.optional() }), z.object({ event: z.literal('turn.error'), message: z.string() }),
  z.object({ event: z.literal('compacted') }), z.object({ event: z.literal('session.reset'), snapshot: snapshotSchema }),
  z.object({ event: z.literal('notice'), message: z.string() }),
  z.object({ event: z.literal('tool.activity'), turnId: z.string(), toolCallId: z.string(), tool: z.string(), label: z.string(), phase: z.enum(['inspecting', 'running', 'succeeded', 'failed']), detail: z.string().optional() }),
  z.object({ event: z.literal('auth.state'), provider, loggedIn: z.boolean(), source: z.string().optional() }),
  z.object({ event: z.literal('auth.device_code'), userCode: z.string(), verificationUri: z.string() }),
  z.object({ event: z.literal('auth.url'), url: z.string() }), z.object({ event: z.literal('auth.progress'), message: z.string() }),
  z.object({ event: z.literal('auth.ok') }), z.object({ event: z.literal('auth.failed'), message: z.string() }),
])
export const frameSchema = z.union([
  z.object({ type: z.literal('res'), id: z.number(), ok: z.literal(true), payload: z.unknown() }),
  z.object({ type: z.literal('res'), id: z.number(), ok: z.literal(false), error: z.string() }),
  z.object({ type: z.literal('event') }).passthrough(),
])
export type LinyState = z.infer<typeof stateSchema>
export type LinySnapshot = z.infer<typeof snapshotSchema>
export type LinySessions = z.infer<typeof sessionsSchema>
export type LinySources = z.infer<typeof sourcesSchema>
export type LinyEvent = z.infer<typeof eventSchema>
export type LinyProvider = Exclude<z.infer<typeof provider>, 'liny'>
export type LinyThinking = z.infer<typeof thinking>
