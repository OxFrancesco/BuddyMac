import { useSyncExternalStore } from 'react'
import type { SpeechPreferences } from './speech'
import { speech } from './speech-state'

interface State { saved: SpeechPreferences | null; draft: SpeechPreferences | null; memory: string; savedMemory: string; error: string; saving: boolean }
let state: State = { saved: null, draft: null, memory: '', savedMemory: '', error: '', saving: false }
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export const talkPrefs = {
  load(force = false) {
    if (loading && !force) return loading
    loading = (async () => {
      try {
        const [saved, memory] = await Promise.all([speech().preferences(), speech().memory()])
        set({ saved, draft: saved, memory, savedMemory: memory, error: '' })
      } catch (error) { set({ error: message(error) }) }
    })()
    return loading
  },
  edit(update: (draft: SpeechPreferences) => SpeechPreferences) { if (state.draft) set({ draft: update(state.draft) }) },
  setMemory(memory: string) { set({ memory }) },
  discard() { set({ draft: state.saved, memory: state.savedMemory, error: '' }) },
  async save() {
    const draft = state.draft
    if (!draft) return false
    set({ saving: true, error: '' })
    try {
      const saved = await speech().savePreferences(draft)
      if (state.memory !== state.savedMemory) await speech().saveMemory(state.memory)
      set({ saved, draft: saved, savedMemory: state.memory, saving: false })
      return true
    } catch (error) { set({ error: message(error), saving: false }); return false }
  },
}

export function useTalkPrefs() {
  const current = useSyncExternalStore(subscribe, () => state)
  const dirty = !!current.draft && (JSON.stringify(current.draft) !== JSON.stringify(current.saved) || current.memory !== current.savedMemory)
  return { ...current, dirty }
}
function subscribe(listener: () => void) { listeners.add(listener); void talkPrefs.load(); return () => { listeners.delete(listener) } }
