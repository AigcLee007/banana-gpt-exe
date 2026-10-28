import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimManagedLocalAsset, createLocalAssetOwnership, managedLocalAssetAllowed } from './portalAssetOwnership'

afterEach(() => vi.unstubAllGlobals())

describe('managed native asset ownership', () => {
  it('hides other owners and unresolved new rows while preserving explicit legacy migration', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const own = createLocalAssetOwnership(storage, 'sidecar:')
    expect(own.allowed('legacy', 2)).toBe(true)
    own.claim('new')
    expect(own.allowed('new', 1)).toBe(false)
    own.claim('new', 1)
    expect(own.allowed('new', 1)).toBe(true)
    expect(own.allowed('new', 2)).toBe(false)
    own.claim('new', 2)
    expect(own.allowed('new', 1)).toBe(true)
    expect(own.allowed('new', 2)).toBe(true)
    expect([...data.values()]).toEqual(['[1,2]'])
    data.set('sidecar:bad', '{bad')
    expect(own.allowed('bad', 2)).toBe(false)
  })
  it('marks a new managed row pending until shared identity resolves, without touching standalone rows', async () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } })
    let resolve!: () => void
    const fake = Object.assign(new EventTarget(), { __AAP__: { baseUrl: '/gw/v1', userId: undefined as number | undefined }, __AAP_ASSETS__: { ready: new Promise<void>(done => { resolve = done }) } })
    vi.stubGlobal('window', fake)
    claimManagedLocalAsset('new')
    expect(managedLocalAssetAllowed('new', 1)).toBe(false)
    fake.__AAP__.userId = 1; resolve(); await fake.__AAP_ASSETS__.ready; await Promise.resolve()
    expect(managedLocalAssetAllowed('new', 1)).toBe(true)
    expect(managedLocalAssetAllowed('new', 2)).toBe(false)
    fake.__AAP__.baseUrl = ''; claimManagedLocalAsset('standalone')
    expect(data.has('aap:studio-local-owner:standalone')).toBe(false)
  })
})
