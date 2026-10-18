import { useEffect, useRef } from 'react'
import type { EventPayload } from '@gpuix/native'

// GPUix has one window-level key handler. Views subscribe here for shortcuts that work without a focused element.
const listeners = new Set<(event: EventPayload) => void>()
export function dispatchWindowKey(event: EventPayload) { for (const listener of listeners) listener(event) }
export function onWindowKey(listener: (event: EventPayload) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Subscribes for the component's lifetime and always calls the latest `listener`. */
export function useWindowKey(listener: (event: EventPayload) => void) {
  const latest = useRef(listener)
  latest.current = listener
  useEffect(() => onWindowKey(event => latest.current(event)), [])
}
