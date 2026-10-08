import type { VideoAssetCategoryRecord, VideoAssetRecord } from './videoAssetTypes'

export type AssetFilterType = 'all' | 'image' | 'video' | 'audio'

export interface VideoAssetFilters {
  type: AssetFilterType
  categoryId: string | null
  query: string
}

export function filterVideoAssets(assets: readonly VideoAssetRecord[], filters: VideoAssetFilters) {
  const query = filters.query.trim().toLocaleLowerCase()
  return assets
    .filter((asset) => filters.type === 'all' || asset.type === filters.type)
    .filter((asset) => filters.categoryId === null
      || (filters.categoryId === '__uncategorized' ? !asset.categoryId : asset.categoryId === filters.categoryId))
    .filter((asset) => !query || `${asset.displayName} ${asset.mime}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function groupVideoAssetsByDate(assets: readonly VideoAssetRecord[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86_400_000
  const groups = new Map<string, VideoAssetRecord[]>()
  for (const asset of assets) {
    const day = new Date(asset.updatedAt)
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
    const label = dayStart === today ? '今天' : dayStart === yesterday ? '昨天' : day.toLocaleDateString()
    const group = groups.get(label) ?? []
    group.push(asset)
    groups.set(label, group)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
}

export function normalizeAssetCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40)
}

export function canUseAssetCategory(name: string, categories: readonly VideoAssetCategoryRecord[]) {
  const normalized = normalizeAssetCategoryName(name)
  if (!normalized || normalized === '全部' || normalized === '未分类') return false
  return !categories.some((category) => category.name === normalized)
}

export function formatAssetSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return '未知大小'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function formatAssetDuration(duration?: number) {
  if (!duration || !Number.isFinite(duration)) return ''
  const seconds = Math.max(0, Math.round(duration))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}秒`
}
