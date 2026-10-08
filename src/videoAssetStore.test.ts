import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoAssetRecord } from './lib/videoAssetTypes'

const database = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  media: new Map<string, unknown>(),
  images: new Map<string, unknown>(),
}))
vi.mock('./lib/db', () => ({
  getImage: async (id: string) => database.images.get(id),
  getAllImages: async () => [...database.images.values()],
  dbTransaction: async (name: string, _mode: string, operation: (store: unknown) => unknown) => {
    let records = database.stores.get(name)
    if (!records) { records = new Map(); database.stores.set(name, records) }
    return operation({
      get: (id: string) => structuredClone(records!.get(id)),
      getAll: () => structuredClone([...records!.values()]),
      put: (record: { id: string }) => { records!.set(record.id, structuredClone(record)); return record.id },
      delete: (id: string) => { records!.delete(id) },
    })
  },
}))
vi.mock('./lib/videoDb', () => ({
  getAllMedia: async () => [...database.media.values()],
  getMedia: async (id: string) => database.media.get(id),
  uploadMediaFile: vi.fn(),
  getMediaBlobUrl: vi.fn(),
}))
import { useVideoAssetStore } from './videoAssetStore'
import { getVideoAsset, putVideoAsset } from './lib/videoAssetDb'

beforeEach(() => {
  database.stores.clear(); database.media.clear(); database.images.clear()
  useVideoAssetStore.setState({ assets: [], categories: [], loading: false, error: null })
})

describe('asset library removal', () => {
  it('keeps removed media and gallery entries hidden across store reloads without deleting shared files', async () => {
    database.media.set('media-1', { id: 'media-1', mime: 'image/png', size: 4, source: 'upload', uploadedAt: 1 })
    database.images.set('gallery-1', { id: 'gallery-1', source: 'generated', dataUrl: 'data:image/png;base64,ZmFrZQ==', createdAt: 1 })
    await useVideoAssetStore.getState().load()
    expect(useVideoAssetStore.getState().assets.map((asset) => asset.id).sort()).toEqual(['image:gallery-1', 'media-1'])
    await useVideoAssetStore.getState().rename('media-1', 'Kept metadata')
    await useVideoAssetStore.getState().remove(['media-1', 'image:gallery-1'])
    useVideoAssetStore.setState({ assets: [] })
    await useVideoAssetStore.getState().load()
    expect(useVideoAssetStore.getState().assets).toEqual([])
    expect((await getVideoAsset('media-1'))?.displayName).toBe('Kept metadata')
    expect(database.media.has('media-1')).toBe(true)
    expect(database.images.has('gallery-1')).toBe(true)
  })

  it('does not register a removed gallery image again under its converted media ID', async () => {
    const gallery: VideoAssetRecord = {
      id: 'image:gallery-1', type: 'image', displayName: 'Gallery', categoryId: null,
      createdAt: 1, updatedAt: 1, mime: 'image/png', size: 4, source: 'gallery',
      storage: 'images', storageId: 'gallery-1', derivedMediaId: 'converted-media-1',
    }
    await putVideoAsset(gallery)
    database.media.set('converted-media-1', { id: 'converted-media-1', mime: 'image/png', size: 4, source: 'upload', uploadedAt: 1 })
    database.images.set('gallery-1', { id: 'gallery-1', source: 'generated', dataUrl: 'data:image/png;base64,ZmFrZQ==', createdAt: 1 })
    await useVideoAssetStore.getState().remove([gallery.id])
    await useVideoAssetStore.getState().load()
    expect(useVideoAssetStore.getState().assets).toEqual([])
    expect(database.media.has('converted-media-1')).toBe(true)
  })
})
