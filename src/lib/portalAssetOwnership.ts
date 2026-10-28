type OwnerStorage = Pick<Storage, 'getItem' | 'setItem'>

export function createLocalAssetOwnership(storage: OwnerStorage, prefix: string) {
  const owners = (key: string): number[] | null => {
    const raw = storage.getItem(prefix + key)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.some(owner => !Number.isSafeInteger(owner) || owner <= 0)) throw Error('素材归属记录不可用')
    return value as number[]
  }
  return {
    claim(key: string, owner?: number) {
      const current = owners(key) || []
      if (owner && !current.includes(owner)) current.push(owner)
      storage.setItem(prefix + key, JSON.stringify(current))
    },
    allowed(key: string, owner?: number) {
      try { const current = owners(key); return current === null || !!owner && current.includes(owner) } catch { return false }
    },
  }
}

type ManagedWindow = Window & { __AAP__?: { baseUrl?: string; userId?: number }; __AAP_ASSETS__?: { ready: Promise<void> } }
const current = () => typeof window === 'undefined' ? undefined : window as ManagedWindow
const registry = () => createLocalAssetOwnership(localStorage, 'aap:studio-local-owner:')

// Record pending ownership before native persistence. Native generation remains
// usable while the shared session loads; pending entries are never migrated.
export function claimManagedLocalAsset(key: string) {
  const w = current()
  if (!w?.__AAP__?.baseUrl) return
  try { registry().claim(key, w.__AAP__.userId) } catch { return }
  if (w.__AAP__.userId) return
  const resolve = async () => {
    if (!w.__AAP_ASSETS__) return
    await w.__AAP_ASSETS__.ready
    if (w.__AAP__?.userId) registry().claim(key, w.__AAP__.userId)
    w.removeEventListener('aap:assets-ready', ready)
  }
  const ready = () => { void resolve().catch(() => undefined) }
  w.addEventListener('aap:assets-ready', ready)
  ready()
}

export function managedLocalAssetAllowed(key: string, owner = current()?.__AAP__?.userId) {
  if (!current()?.__AAP__?.baseUrl) return true
  try { return registry().allowed(key, owner) } catch { return false }
}

export function assertManagedLocalAsset(key: string, owner = current()?.__AAP__?.userId) {
  if (current()?.__AAP__?.baseUrl && (owner !== current()?.__AAP__?.userId || !managedLocalAssetAllowed(key, owner))) throw Error('此本机素材属于其他账号，请刷新素材列表')
}
