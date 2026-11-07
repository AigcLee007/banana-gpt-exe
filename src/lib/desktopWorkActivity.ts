// Tracks asynchronous imports that are not generation tasks (including the asset library).
let active = 0
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export function hasDesktopWork() { return active > 0 }
export function subscribeDesktopWork(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function beginDesktopWork() {
  active++
  notify()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    active--
    notify()
  }
}
export async function withDesktopWork<T>(operation: () => Promise<T>): Promise<T> {
  const finish = beginDesktopWork()
  try { return await operation() } finally { finish() }
}
