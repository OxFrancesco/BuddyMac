import type { LinyClient } from './liny'

export async function submitLinyMessage(
  client: Pick<LinyClient, 'send' | 'snapshot'>,
  text: string,
  images: { data: string; mimeType: string }[],
  setBusy: (busy: boolean) => void,
) {
  setBusy(true)
  try {
    await client.send(text, images)
    return await client.snapshot()
  } finally {
    setBusy(false)
  }
}
