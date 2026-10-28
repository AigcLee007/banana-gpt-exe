export function notifyNewStudioMedia(storage: 'image' | 'media', id: string, title: string, source?: string) {
  if (typeof window === 'undefined' || !window.__AAP__?.baseUrl) return
  window.dispatchEvent(new CustomEvent('aap:studio-media', { detail: { storage, id, title, source } }))
}
