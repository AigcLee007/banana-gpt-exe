import { describe, expect, it } from 'vitest'
import { canUseAssetCategory, filterVideoAssets, formatAssetDuration, formatAssetSize, groupVideoAssetsByDate, normalizeAssetCategoryName } from './videoAssetLibrary'
import type { VideoAssetRecord } from './videoAssetTypes'

const asset = (overrides: Partial<VideoAssetRecord> = {}): VideoAssetRecord => ({
  id: 'a', type: 'image', displayName: '商品图.png', categoryId: null,
  createdAt: Date.parse('2026-10-03T10:00:00Z'), updatedAt: Date.parse('2026-10-03T10:00:00Z'),
  mime: 'image/png', size: 1024, source: 'upload', storage: 'media', storageId: 'a', derivedMediaId: null, ...overrides,
})

describe('video asset library helpers', () => {
  it('filters by type, uncategorized, and query without changing IDs', () => {
    const assets = [asset(), asset({ id: 'b', type: 'video', displayName: '镜头.mp4', mime: 'video/mp4', categoryId: 'cat' })]
    expect(filterVideoAssets(assets, { type: 'image', categoryId: null, query: '商品' }).map((item) => item.id)).toEqual(['a'])
    expect(filterVideoAssets(assets, { type: 'all', categoryId: '__uncategorized', query: '' }).map((item) => item.id)).toEqual(['a'])
  })

  it('groups assets by date', () => {
    const now = new Date('2026-10-03T12:00:00Z')
    const groups = groupVideoAssetsByDate([asset(), asset({ id: 'old', updatedAt: Date.parse('2026-10-01T12:00:00Z') })], now)
    expect(groups[0].label).toBe('今天')
    expect(groups[1].items[0].id).toBe('old')
  })

  it('normalizes category names and rejects reserved or duplicate names', () => {
    expect(normalizeAssetCategoryName('  商品   图  ')).toBe('商品 图')
    expect(canUseAssetCategory('全部', [])).toBe(false)
    expect(canUseAssetCategory('产品', [{ id: '1', name: '产品', createdAt: 0, updatedAt: 0 }])).toBe(false)
    expect(canUseAssetCategory('场景', [])).toBe(true)
  })

  it('formats size and duration', () => {
    expect(formatAssetSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatAssetDuration(65)).toBe('1:05')
  })
})
