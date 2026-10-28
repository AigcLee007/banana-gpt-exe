import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredImage } from '../types'

const state = vi.hoisted(() => ({
  owner: 8,
  valid: true,
  saved: new Map<string, StoredImage>(),
  claimed: [] as number[],
  notices: [] as unknown[][],
  ownership: new Map<string, string>(),
  failOwnershipRead: false,
  skipClaimWrite: false,
  read: undefined as undefined | (() => Promise<string>),
  hash: undefined as undefined | (() => Promise<string>),
  beforeTransaction: undefined as undefined | (() => Promise<void>),
  beforeComplete: undefined as undefined | (() => Promise<void>),
}))
vi.mock('./db', () => ({
  hashDataUrl: async () => state.hash ? state.hash() : 'product-image',
  getImage: async (id: string) => state.saved.get(id),
  dbTransaction: async (_name: string, _mode: string, operation: (store: unknown) => unknown) => {
    await state.beforeTransaction?.()
    operation({ put: (image: StoredImage) => { state.saved.set(image.id, image); return image.id } })
    await state.beforeComplete?.()
  },
}))
vi.mock('./portalAssetOwnership', () => ({
  claimManagedLocalAsset: (key: string) => {
    state.claimed.push(state.owner)
    if (!state.skipClaimWrite) state.ownership.set(`aap:studio-local-owner:${key}`, JSON.stringify([state.owner]))
  },
}))
vi.mock('./portalAssetEvents', () => ({
  notifyNewStudioMedia: (...args: unknown[]) => { state.notices.push(args) },
}))

import { uploadEcommerceReference } from './agentEcommerceUpload'

const file = () => new File(['product photo'], 'product.png', { type: 'image/png' })
const guard = () => { if (!state.valid) throw Error('context changed') }
const invalidate = () => { state.valid = false; state.owner = 9 }

beforeEach(() => {
  state.owner = 8; state.valid = true; state.saved.clear(); state.claimed = []; state.notices = []
  state.ownership.clear(); state.failOwnershipRead = false; state.skipClaimWrite = false
  state.read = undefined; state.hash = undefined; state.beforeTransaction = undefined; state.beforeComplete = undefined
  vi.stubGlobal('window', { __AAP__: { baseUrl: '/gw/v1', get userId() { return state.owner } } })
  vi.stubGlobal('localStorage', { getItem(key: string) {
    if (state.failOwnershipRead) throw Error('storage unavailable')
    return state.ownership.get(key) ?? null
  } })
  vi.stubGlobal('FileReader', class {
    result: string | null = null
    onload?: () => void
    onerror?: () => void
    error = new Error('read failed')
    readAsDataURL() {
      void (state.read ? state.read() : Promise.resolve('data:image/png;base64,cHJvZHVjdA==')).then(result => {
        this.result = result; this.onload?.()
      }).catch(() => this.onerror?.())
    }
  })
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 4000, close: vi.fn() })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('ecommerce reference upload context isolation', () => {
  it('stores a real decoded upload under the captured owner and notifies only after persistence', async () => {
    const result = await uploadEcommerceReference(file(), 8, guard)
    expect(result).toEqual({ id: 'product-image', dataUrl: 'data:image/png;base64,cHJvZHVjdA==' })
    expect(state.saved.get(result.id)).toMatchObject({ id: result.id, source: 'upload', width: 3000, height: 4000, dataUrl: result.dataUrl })
    expect(state.claimed).toEqual([8])
    expect(state.notices).toEqual([['image', 'product-image', '上传参考图', 'agent']])
  })

  it('preserves metadata for an existing content-addressed image', async () => {
    const original: StoredImage = { id: 'product-image', dataUrl: 'data:image/png;base64,cHJvZHVjdA==', source: 'generated', createdAt: 7, width: 1024, height: 1024 }
    state.saved.set(original.id, original)
    await uploadEcommerceReference(file(), 8, guard)
    expect(state.saved.get(original.id)).toEqual(original)
    expect(state.claimed).toEqual([8])
  })

  it.each(['read', 'hash', 'transaction'] as const)('does not persist, claim or archive when context changes during %s', async stage => {
    if (stage === 'read') state.read = async () => { invalidate(); return 'data:image/png;base64,cHJvZHVjdA==' }
    if (stage === 'hash') state.hash = async () => { invalidate(); return 'product-image' }
    if (stage === 'transaction') state.beforeTransaction = async () => { invalidate() }
    await expect(uploadEcommerceReference(file(), 8, guard)).rejects.toThrow('context changed')
    expect(state.saved.size).toBe(0)
    expect(state.claimed).toEqual([])
    expect(state.notices).toEqual([])
  })

  it('does not archive or return a draft image if context changes after a committed old-owner write', async () => {
    state.beforeComplete = async () => { invalidate() }
    await expect(uploadEcommerceReference(file(), 8, guard)).rejects.toThrow('context changed')
    expect(state.saved.size).toBe(1)
    expect(state.claimed).toEqual([8])
    expect(state.notices).toEqual([])
  })

  it('checks the captured owner even when the supplied conversation guard omits identity', async () => {
    state.read = async () => { state.owner = 9; return 'data:image/png;base64,cHJvZHVjdA==' }
    await expect(uploadEcommerceReference(file(), 8, () => undefined)).rejects.toThrow(/账户/)
    expect(state.saved.size).toBe(0)
    expect(state.claimed).toEqual([])
  })

  it('cleans decoded resources and does not persist when context changes while decoding', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', async () => { invalidate(); return { width: 64, height: 64, close } })
    await expect(uploadEcommerceReference(file(), 8, guard)).rejects.toThrow('context changed')
    expect(close).toHaveBeenCalledOnce()
    expect(state.saved.size).toBe(0)
  })

  it('rejects invalid input or undecodable image contents before side effects', async () => {
    await expect(uploadEcommerceReference(new File(['svg'], 'fake.svg', { type: 'image/svg+xml' }), 8, guard)).rejects.toThrow()
    vi.stubGlobal('createImageBitmap', async () => { throw Error('invalid image') })
    await expect(uploadEcommerceReference(file(), 8, guard)).rejects.toThrow('invalid image')
    expect(state.saved.size).toBe(0)
    expect(state.claimed).toEqual([])
    expect(state.notices).toEqual([])
  })

  it('decodes through Image when bitmap decoding is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const release = vi.fn()
    vi.stubGlobal('Image', class {
      naturalWidth = 1200
      naturalHeight = 1600
      onload?: () => void
      onerror?: () => void
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); else release() }
    })
    await uploadEcommerceReference(file(), 8, guard)
    expect(state.saved.get('product-image')).toMatchObject({ width: 1200, height: 1600 })
    expect(release).toHaveBeenCalledOnce()
  })

  it.each(['missing', 'unreadable', 'malformed', 'wrong-owner'] as const)('fails before persistence when ownership is %s after claiming', async failure => {
    state.skipClaimWrite = true
    if (failure === 'unreadable') state.failOwnershipRead = true
    if (failure === 'malformed') state.ownership.set('aap:studio-local-owner:image:product-image', '{bad json')
    if (failure === 'wrong-owner') state.ownership.set('aap:studio-local-owner:image:product-image', '[9]')
    await expect(uploadEcommerceReference(file(), 8, guard)).rejects.toThrow(/归属/)
    expect(state.saved.size).toBe(0)
    expect(state.notices).toEqual([])
  })
})
