import { describe, expect, it } from 'vitest'
import { normalizeVideoAsset } from './videoAssetDb'
import { imageAssetId } from './videoAssetBridge'

describe('cross-storage video assets', () => {
  it('normalizes legacy media assets without changing their IDs', () => {
    const asset = normalizeVideoAsset({ id: 'media-1', type: 'image', displayName: 'old', categoryId: null, createdAt: 1, updatedAt: 1, mime: 'image/png', size: 4, source: 'upload' })
    expect(asset.id).toBe('media-1')
    expect(asset.storage).toBe('media')
    expect(asset.storageId).toBe('media-1')
    expect(asset.derivedMediaId).toBeNull()
  })

  it('uses a namespaced ID for gallery image assets', () => {
    expect(imageAssetId('abc')).toBe('image:abc')
  })
})
