export interface DebugEntry {
  at: number
  kind: string
  text: string
}

const MAX_ENTRIES = 80
const entries: DebugEntry[] = []
const listeners = new Set<() => void>()
let lastRecording: { wav: Blob; info: string; at: number } | null = null

function notify(): void {
  for (const cb of listeners) cb()
}

export function debugLog(kind: string, text: string): void {
  entries.unshift({ at: Date.now(), kind, text })
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
  notify()
}

export function setLastRecording(wav: Blob, info: string): void {
  lastRecording = { wav, info, at: Date.now() }
  notify()
}

export function getDebugEntries(): readonly DebugEntry[] {
  return entries
}

export function getLastRecording(): { wav: Blob; info: string; at: number } | null {
  return lastRecording
}

export function clearDebug(): void {
  entries.length = 0
  lastRecording = null
  notify()
}

export function onDebugChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
