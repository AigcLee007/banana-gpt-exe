import type { MediaRecord, VideoReferenceType } from './videoTypes'
import type { StoredImage } from '../types'
import { getImage, getAllImages } from './db'
import { getMedia, getMediaBlobUrl as getStoredMediaBlobUrl, uploadMediaFile } from './videoDb'
import type { VideoAssetCategoryRecord, VideoAssetRecord } from './videoAssetTypes'
import { dbTransaction } from './db'

const STORE_ASSETS = 'videoAssets'
const STORE_CATEGORIES = 'videoAssetCategories'

export function normalizeVideoAsset(record: Partial<VideoAssetRecord> & Pick<VideoAssetRecord, 'id'>): VideoAssetRecord {
  const storage = record.storage === 'images' ? 'images' : 'media'
  return {
    id: record.id,
    type: record.type ?? 'image',
    displayName: record.displayName || '素材',
    categoryId: record.categoryId ?? null,
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? record.createdAt ?? Date.now(),
    mime: record.mime || (record.type === 'image' ? 'image/png' : record.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
    size: record.size ?? 0,
    duration: record.duration,
    width: record.width,
    height: record.height,
    source: record.source ?? (storage === 'images' ? 'gallery' : 'upload'),
    storage,
    storageId: record.storageId || record.id,
    derivedMediaId: record.derivedMediaId ?? null,
    removedAt: record.removedAt ?? null,
  }
}

export async function getAllVideoAssets(): Promise<VideoAssetRecord[]> {
  const records = await dbTransaction<VideoAssetRecord[]>(STORE_ASSETS, 'readonly', (store) => store.getAll())
  return records.map(normalizeVideoAsset)
}

export async function getVideoAsset(id: string): Promise<VideoAssetRecord | undefined> {
  const record = await dbTransaction<VideoAssetRecord | undefined>(STORE_ASSETS, 'readonly', (store) => store.get(id))
  return record ? normalizeVideoAsset(record) : undefined
}

export function putVideoAsset(asset: VideoAssetRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_ASSETS, 'readwrite', (store) => store.put(asset))
}

export function deleteVideoAsset(id: string): Promise<undefined> {
  return dbTransaction(STORE_ASSETS, 'readwrite', (store) => store.delete(id))
}

export async function removeVideoAssetFromLibrary(id: string): Promise<void> {
  const asset = await getVideoAsset(id)
  if (asset) await putVideoAsset({ ...asset, removedAt: Date.now(), updatedAt: Date.now() })
}

export function getAllVideoAssetCategories(): Promise<VideoAssetCategoryRecord[]> {
  return dbTransaction(STORE_CATEGORIES, 'readonly', (store) => store.getAll())
}

export function putVideoAssetCategory(category: VideoAssetCategoryRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_CATEGORIES, 'readwrite', (store) => store.put(category))
}

export function deleteVideoAssetCategory(id: string): Promise<undefined> {
  return dbTransaction(STORE_CATEGORIES, 'readwrite', (store) => store.delete(id))
}

export async function ensureMediaAssets(media: MediaRecord[]): Promise<VideoAssetRecord[]> {
  const existing = await getAllVideoAssets()
  const existingIds = new Set(existing.map((asset) => asset.id))
  const galleryMediaIds = new Set(existing.flatMap((asset) => asset.storage === 'images' && asset.derivedMediaId ? [asset.derivedMediaId] : []))
  const now = Date.now()
  const created = media.flatMap((record): VideoAssetRecord[] => {
    if (existingIds.has(record.id) || galleryMediaIds.has(record.id)) return []
    const type = mediaType(record.mime)
    if (!type) return []
    return [{
      id: record.id,
      type,
      displayName: record.filename || `${typeLabel(type)}素材`,
      categoryId: null,
      createdAt: record.uploadedAt || now,
      updatedAt: now,
      mime: record.mime,
      size: record.size,
      duration: record.duration,
      width: record.width,
      height: record.height,
      source: record.source,
      storage: 'media',
      storageId: record.id,
      derivedMediaId: null,
    }]
  })
  if (created.length) {
    await Promise.all(created.map(putVideoAsset))
  }
  return [...existing, ...created].filter((asset) => !asset.removedAt && !(asset.storage === 'media' && galleryMediaIds.has(asset.storageId)))
}

export function mediaType(mime: string) {
  if (mime.startsWith('image/')) return 'image' as const
  if (mime.startsWith('video/')) return 'video' as const
  if (mime.startsWith('audio/')) return 'audio' as const
  return null
}

export function typeLabel(type: 'image' | 'video' | 'audio') {
  return type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'
}
