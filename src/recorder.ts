import { recordShortcut } from './platform'
import { fromCocoa, type RecordedShortcut } from './shortcuts'

let active: ((shortcut: RecordedShortcut | null) => void) | null = null

export function startRecording(callback: (shortcut: RecordedShortcut | null) => void) {
  active?.(null)
  active = callback
  recordShortcut(true)
}
export function stopRecording(callback?: (shortcut: RecordedShortcut | null) => void) {
  if (callback && active !== callback) return
  active = null
  recordShortcut(false)
}
export function handleRecorderAction(value: Record<string, unknown>): boolean {
  if (value.action !== 'shortcut-recorded' && value.action !== 'shortcut-cancelled') return false
  const callback = active
  active = null
  if (value.action === 'shortcut-recorded' && typeof value.keyCode === 'number' && typeof value.modifiers === 'number' && typeof value.label === 'string') {
    callback?.({ keyCode: value.keyCode, key: value.label, modifiers: fromCocoa(value.modifiers) })
  } else callback?.(null)
  return true
}
