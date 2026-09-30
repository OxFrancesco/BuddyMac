import { useCallback, useState } from 'react'

// Panels unmount when you leave them, because GPUI lays out every mounted element on every frame.
// Text you were typing survives the round trip here.
const values = new Map<string, unknown>()
export function useSticky<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (values.has(key) ? values.get(key) as T : initial))
  const set = useCallback((next: T | ((previous: T) => T)) => {
    setValue(previous => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      values.set(key, resolved)
      return resolved
    })
  }, [key])
  return [value, set]
}
