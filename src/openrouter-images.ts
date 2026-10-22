import type { AssistantImages, ImageApi, ImageContent, ImageModel, ImagesContext, ImagesOptions } from '@earendil-works/pi-ai'

/**
 * Dock icons through OpenRouter's Images API. GPT Image models are only served on `/images`;
 * pi-ai's OpenRouter image API calls chat completions. Every icon is a square PNG with a transparent background.
 */
export async function generateTransparentIcon(model: ImageModel<ImageApi>, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages> {
  const output: AssistantImages = { api: model.api, provider: model.provider, model: model.id, output: [], stopReason: 'stop', timestamp: Date.now() }
  try {
    if (!options?.apiKey) throw new Error('Add an OpenRouter key to generate icons.')
    const prompt = context.input.flatMap(item => item.type === 'text' ? [item.text] : []).join('\n')
    const references = context.input.flatMap(item => item.type === 'image' ? [{ type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${item.data}` } }] : [])
    const response = await fetch(`${model.baseUrl}/images`, {
      method: 'POST', signal: options.signal,
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: model.id, prompt, n: 1, aspect_ratio: '1:1', background: 'transparent', output_format: 'png', ...references.length ? { input_references: references } : {} }),
    })
    const body: unknown = await response.json().catch(() => undefined)
    const record = body && typeof body === 'object' ? body as { error?: { message?: unknown }; data?: { b64_json?: unknown; media_type?: unknown }[] } : {}
    if (!response.ok) throw new Error(typeof record.error?.message === 'string' ? record.error.message : `OpenRouter returned ${response.status}.`)
    const image = record.data?.[0]
    if (typeof image?.b64_json !== 'string') throw new Error('The model returned no image.')
    output.output.push({ type: 'image', mimeType: typeof image.media_type === 'string' ? image.media_type : 'image/png', data: image.b64_json } satisfies ImageContent)
  } catch (cause) {
    output.stopReason = options?.signal?.aborted ? 'aborted' : 'error'
    output.errorMessage = cause instanceof Error ? cause.message : 'Image generation failed.'
  }
  return output
}

/** True for a PNG whose pixels carry alpha: an RGBA or grey-alpha colour type, or a tRNS chunk. */
export function transparentPng(data: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (data.length < 33 || signature.some((byte, index) => data[index] !== byte)) return false
  if (data[25] === 4 || data[25] === 6) return true
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let offset = 8; offset + 8 <= data.length;) {
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8))
    if (type === 'tRNS') return true
    if (type === 'IDAT' || type === 'IEND') return false
    offset += 12 + view.getUint32(offset)
  }
  return false
}
